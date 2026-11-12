import "./mock-code-index-log"
import { CodeIndexSearchService } from "../search-service"
import { OpenAICompatibleEmbedder } from "../embedders/openai-compatible"
import { FileFailureRegistry } from "../file-failure-registry"
import { ProviderPacerRegistry } from "../provider-pacer"
import type { CodeIndexConfigManager } from "../config-manager"
import type { CodeIndexStateManager } from "../state-manager"
import type { IVectorStore } from "../interfaces"
import type { IndexingState } from "../interfaces/manager"

import { SearchProviderRateLimitError } from "../shared/indexing-errors"
import englishEmbeddings from "../../../i18n/locales/en/embeddings.json"

vi.mock("../../../i18n", async () => {
	const { default: messages } = await import("../../../i18n/locales/en/embeddings.json")
	return {
		t: (key: string) => (key === "embeddings:searchProviderRateLimited" ? messages.searchProviderRateLimited : key),
	}
})

const transports = [
	["SDK", "https://example.test/v1"],
	["direct fetch", "https://example.test/embeddings"],
] as const

function response(status = 429, headers: Record<string, string> = {}) {
	return new Response(
		JSON.stringify(status === 200 ? { data: [{ embedding: [1, 0] }] } : { error: { message: "unavailable" } }),
		{ status, headers: { "content-type": "application/json", ...headers } },
	)
}

function prepare(baseUrl: string, state: IndexingState = "Indexing", failed = true) {
	const failures = new FileFailureRegistry()
	if (failed) {
		failures.renew("pending.ts", "revision")
		failures.record("pending.ts", "revision", "embed", "unavailable", 1, "retrying", "server")
	}
	const snapshot = failures.list()
	const registryMethods = ["record", "clear", "renew", "resetAllBudgets"] as const
	const registryWrites = registryMethods.map((method) => vi.spyOn(failures, method))
	const stateManager = { getCurrentStatus: () => ({ systemStatus: state }), setSystemState: vi.fn() }
	const config = {
		isFeatureEnabled: true,
		isFeatureConfigured: true,
		currentSearchMinScore: 0.4,
		currentSearchMaxResults: 12,
	}
	const results = [{ id: "point", score: 0.9, payload: { filePath: "good.ts" } }]
	const store = { search: vi.fn().mockResolvedValue(results), collectionExists: vi.fn().mockResolvedValue(true) }
	const registry = new ProviderPacerRegistry()
	const embedder = new OpenAICompatibleEmbedder(baseUrl, "test-key")
	const pacer = registry.get(embedder.rateLimitScope)
	const service = new CodeIndexSearchService(
		config as CodeIndexConfigManager,
		stateManager as unknown as CodeIndexStateManager,
		embedder,
		store as unknown as IVectorStore,
		failures,
		registry,
	)
	function expectUnchanged() {
		expect(stateManager.setSystemState).not.toHaveBeenCalled()
		expect(stateManager.getCurrentStatus().systemStatus).toBe(state)
		expect(failures.list()).toEqual(snapshot)
		for (const write of registryWrites) expect(write).not.toHaveBeenCalled()
	}
	return { service, store, results, expectUnchanged, pacer }
}

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date("2026-11-10T12:00:00Z"))
})
afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe.each(transports)("T27 search query retry via %s transport", (_transport, baseUrl) => {
	it.each([true, false])("bypasses a 120-second pause and occupied permits, matches: %s", async (matches) => {
		const request = vi.fn(async () => response(200))
		vi.stubGlobal("fetch", request)
		const { service, store, results, expectUnchanged, pacer } = prepare(baseUrl)
		let release!: () => void
		const held = new Promise<void>((resolve) => {
			release = resolve
		})
		const occupied = Array.from({ length: pacer.state().limit }, () => pacer.run(undefined, undefined, () => held))
		await vi.advanceTimersByTimeAsync(0)
		pacer.reportRateLimit({ status: 429, headers: { "retry-after": "120" } }, pacer.markIssued())
		const before = pacer.state()
		store.search.mockResolvedValue(matches ? results : [])
		await expect(service.searchIndex("query")).resolves.toMatchObject({ results: matches ? results : [] })
		expect(request).toHaveBeenCalledTimes(1)
		expect(pacer.state()).toMatchObject({ ...before, issueSeq: before.issueSeq + 1 })
		expectUnchanged()
		release()
		await Promise.all(occupied)
		await vi.advanceTimersByTimeAsync(120_000)
	})

	it("reports each 429 immediately without retries or repeated allowance reduction", async () => {
		const request = vi.fn(async () => response(429, { "retry-after": "120" }))
		vi.stubGlobal("fetch", request)
		const { service, store, expectUnchanged, pacer } = prepare(baseUrl)
		let firstLimit: number | undefined
		for (const attempt of [1, 2, 3]) {
			const error = await service.searchIndex("query").catch((error: unknown) => error)
			expect(error).toBeInstanceOf(SearchProviderRateLimitError)
			expect(error).toMatchObject({
				message: englishEmbeddings.searchProviderRateLimited,
				classification: "rate-limit",
				statusCode: 429,
				retryAfterMs: 120_000,
				cause: expect.objectContaining({ classification: "rate-limit", statusCode: 429 }),
			})
			expect(request).toHaveBeenCalledTimes(attempt)
			firstLimit ??= pacer.state().limit
			expect(pacer.state()).toMatchObject({ limit: firstLimit, consecutiveRateLimits: 1, issueSeq: attempt })
			await vi.advanceTimersByTimeAsync(1)
		}
		expect(store.search).not.toHaveBeenCalled()
		expectUnchanged()
		await vi.advanceTimersByTimeAsync(120_000)
	})

	it.each(["server", "connection"])("retains bounded %s retries", async (failure) => {
		const request = vi.fn()
		if (failure === "server") request.mockResolvedValueOnce(response(503))
		else request.mockRejectedValueOnce(new TypeError("fetch failed", { cause: new Error("network") }))
		request.mockResolvedValueOnce(response(200))
		vi.stubGlobal("fetch", request)
		const { service, results, expectUnchanged } = prepare(baseUrl)
		const pending = service.searchIndex("query")
		await vi.advanceTimersByTimeAsync(499)
		expect(request).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		await expect(pending).resolves.toEqual({
			results,
			partial: true,
			failedFiles: ["pending.ts"],
			waitingFiles: [],
		})
		expect(request).toHaveBeenCalledTimes(2)
		expectUnchanged()
	})

	it.each([true, false])(
		"fails 401 after one request without registry changes, existing failures: %s",
		async (failed) => {
			const request = vi.fn(async () => response(401))
			vi.stubGlobal("fetch", request)
			const { service, store, expectUnchanged } = prepare(baseUrl, "Indexing", failed)
			await expect(service.searchIndex("query")).rejects.toMatchObject({
				classification: "permanent",
				statusCode: 401,
				attempts: 1,
			})
			expect(request).toHaveBeenCalledTimes(1)
			expect(store.search).not.toHaveBeenCalled()
			expect(vi.getTimerCount()).toBe(0)
			expectUnchanged()
		},
	)

	it("cancels a lifecycle retry wait with no further transport request", async () => {
		const request = vi.fn(async () => response(503))
		vi.stubGlobal("fetch", request)
		const { service, store, expectUnchanged } = prepare(baseUrl)
		const lifecycleController = new AbortController()
		const outcome = service
			.searchIndex("query", undefined, lifecycleController.signal)
			.catch((error: unknown) => error)
		await vi.advanceTimersByTimeAsync(0)
		await vi.advanceTimersByTimeAsync(499)
		expect(request).toHaveBeenCalledTimes(1)
		lifecycleController.abort()
		await expect(outcome).resolves.toBe(lifecycleController.signal.reason)
		await vi.advanceTimersByTimeAsync(120_000)
		expect(request).toHaveBeenCalledTimes(1)
		expect(store.search).not.toHaveBeenCalled()
		expect(vi.getTimerCount()).toBe(0)
		expectUnchanged()
	})

	it("aborts an in-flight transport request and never retries", async () => {
		let transportSignal: AbortSignal | undefined
		const request = vi.fn((_input: unknown, options?: RequestInit) => {
			transportSignal = options?.signal ?? undefined
			return new Promise<Response>((_resolve, reject) => {
				transportSignal?.addEventListener("abort", () => reject(transportSignal?.reason), { once: true })
			})
		})
		vi.stubGlobal("fetch", request)
		const { service, store, expectUnchanged } = prepare(baseUrl)
		const lifecycleController = new AbortController()
		const outcome = service
			.searchIndex("query", undefined, lifecycleController.signal)
			.catch((error: unknown) => error)
		await vi.advanceTimersByTimeAsync(0)
		expect(request).toHaveBeenCalledTimes(1)
		expect(transportSignal?.aborted).toBe(false)
		lifecycleController.abort()
		await expect(outcome).resolves.toBe(lifecycleController.signal.reason)
		expect(transportSignal?.aborted).toBe(true)
		await vi.advanceTimersByTimeAsync(120_000)
		expect(request).toHaveBeenCalledTimes(1)
		expect(store.search).not.toHaveBeenCalled()
		expect(vi.getTimerCount()).toBe(0)
		expectUnchanged()
	})

	it("issues no transport request for an already cancelled lifecycle", async () => {
		const request = vi.fn()
		vi.stubGlobal("fetch", request)
		const { service, store, expectUnchanged } = prepare(baseUrl)
		const signal = AbortSignal.abort()
		await expect(service.searchIndex("query", undefined, signal)).rejects.toBe(signal.reason)
		expect(request).not.toHaveBeenCalled()
		expect(store.search).not.toHaveBeenCalled()
		expectUnchanged()
	})

	it.each(["Indexed", "Indexing", "Standby"] as const)(
		"leaves %s and its registry unchanged when vector-store search fails",
		async (state) => {
			const request = vi.fn(async () => response(200))
			vi.stubGlobal("fetch", request)
			const { service, store, expectUnchanged } = prepare(baseUrl, state)
			const error = Object.assign(new Error("store unavailable"), { status: 503 })
			store.search.mockRejectedValue(error)
			await expect(service.searchIndex("query")).rejects.toBe(error)
			expect(request).toHaveBeenCalledTimes(1)
			expect(store.search).toHaveBeenCalledOnce()
			expect(vi.getTimerCount()).toBe(0)
			expectUnchanged()
		},
	)
})
