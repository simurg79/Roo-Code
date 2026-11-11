import "./mock-code-index-log"
import { CodeIndexSearchService } from "../search-service"
import { OpenAICompatibleEmbedder } from "../embedders/openai-compatible"
import { FileFailureRegistry } from "../file-failure-registry"
import type { CodeIndexConfigManager } from "../config-manager"
import type { CodeIndexStateManager } from "../state-manager"
import type { IVectorStore } from "../interfaces"
import type { IndexingState } from "../interfaces/manager"

vi.mock("../../../i18n", () => ({ t: (key: string) => key }))

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
		failures.record("pending.ts", "revision", "embed", "waiting", 1, "retrying", "rate-limit")
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
	const service = new CodeIndexSearchService(
		config as CodeIndexConfigManager,
		stateManager as unknown as CodeIndexStateManager,
		new OpenAICompatibleEmbedder(baseUrl, "test-key"),
		store as unknown as IVectorStore,
		failures,
	)
	function expectUnchanged() {
		expect(stateManager.setSystemState).not.toHaveBeenCalled()
		expect(stateManager.getCurrentStatus().systemStatus).toBe(state)
		expect(failures.list()).toEqual(snapshot)
		for (const write of registryWrites) expect(write).not.toHaveBeenCalled()
	}
	return { service, store, results, expectUnchanged }
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
	it.each([2, 60])("returns results after two requests, honoring retry-after: %s", async (seconds) => {
		const request = vi.fn().mockResolvedValueOnce(response(429, { "retry-after": String(seconds) }))
		request.mockResolvedValueOnce(response(200))
		vi.stubGlobal("fetch", request)
		const { service, store, results, expectUnchanged } = prepare(baseUrl)
		const pending = service.searchIndex("query", "src")
		await vi.advanceTimersByTimeAsync(0)
		expect(request).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(seconds * 1000 - 1)
		expect(request).toHaveBeenCalledTimes(1)
		expectUnchanged()
		await vi.advanceTimersByTimeAsync(1)
		await expect(pending).resolves.toEqual({ results, partial: true, failedFiles: ["pending.ts"] })
		expect(request).toHaveBeenCalledTimes(2)
		expect(store.search).toHaveBeenCalledOnce()
		expectUnchanged()
	})

	it.each([
		["missing", {}],
		["invalid", { "retry-after": "invalid" }],
		["over cap seconds", { "retry-after": "61" }],
		["over cap milliseconds", { "retry-after-ms": "60001" }],
		["over cap date", { "retry-after": "Tue, 10 Nov 2026 12:01:01 GMT" }],
	] as const)("exhausts three 429s with default 500/1000 ms waits: %s", async (_name, headers) => {
		const request = vi.fn(async () => response(429, headers))
		vi.stubGlobal("fetch", request)
		const { service, store, expectUnchanged } = prepare(baseUrl)
		const outcome = service.searchIndex("query").catch((error: unknown) => error)
		await vi.advanceTimersByTimeAsync(0)
		expect(request).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(499)
		expect(request).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1)
		expect(request).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(999)
		expect(request).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(1)
		await expect(outcome).resolves.toMatchObject({ classification: "rate-limit", attempts: 3, statusCode: 429 })
		expect(request).toHaveBeenCalledTimes(3)
		expect(store.search).not.toHaveBeenCalled()
		expect(vi.getTimerCount()).toBe(0)
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
		const request = vi.fn(async () => response(429, { "retry-after": "60" }))
		vi.stubGlobal("fetch", request)
		const { service, store, expectUnchanged } = prepare(baseUrl)
		const lifecycleController = new AbortController()
		const outcome = service
			.searchIndex("query", undefined, lifecycleController.signal)
			.catch((error: unknown) => error)
		await vi.advanceTimersByTimeAsync(0)
		await vi.advanceTimersByTimeAsync(59_999)
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
