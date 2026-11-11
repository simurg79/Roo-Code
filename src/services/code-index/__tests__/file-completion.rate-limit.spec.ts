import "./mock-code-index-log"
import { OpenAICompatibleEmbedder } from "../embedders/openai-compatible"
import { CodeIndexOllamaEmbedder } from "../embedders/ollama"
import { transportWriter } from "./transport-writer"

vi.mock("../../../i18n", () => ({ t: (key: string) => key }))

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date("2026-11-10T12:00:00Z"))
	vi.spyOn(Math, "random").mockReturnValue(0)
})
afterEach(() => {
	vi.restoreAllMocks()
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

const factories = [
	["SDK", () => new OpenAICompatibleEmbedder("https://example.test/v1", "test-key")],
	["fetch", () => new OpenAICompatibleEmbedder("https://example.test/embeddings", "test-key")],
	["Ollama", () => new CodeIndexOllamaEmbedder({ ollamaBaseUrl: "https://example.test" })],
] as const

describe.each(factories)("T25 %s full-path timer boundary", (_name, createEmbedder) => {
	it.each([
		["seconds", "2", 2000],
		["seconds", "60", 60_000],
		["seconds", "61", 61_000],
		["milliseconds", "60001", 60_001],
		["milliseconds", "2500", 2500],
		["date", "5", 5000],
		["date", "61", 61_000],
		["date", "-5", 500],
		["seconds", "invalid", 500],
	] as const)("waits for %s %s without exhaustion", async (kind, value, firstDelay) => {
		const request = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: { message: "limited" } }), {
					status: 429,
					headers: {
						"content-type": "application/json",
						[kind === "milliseconds" ? "retry-after-ms" : "retry-after"]:
							kind === "date" ? new Date(Date.now() + Number(value) * 1000).toUTCString() : value,
					},
				}),
		)
		vi.stubGlobal("fetch", request)
		const controller = new AbortController()
		const { replace, failures, pacers, cache } = transportWriter()
		const pending = replace(createEmbedder(), controller.signal).catch((error: unknown) => error)
		await vi.advanceTimersByTimeAsync(0)
		try {
			for (const attempt of [1, 2, 3, 4]) {
				const delay = firstDelay === 500 ? 500 * 2 ** (attempt - 1) : firstDelay
				expect(pacers.waitingPaths()).toEqual(["test.ts"])
				expect(failures.list()).toEqual([])
				expect(cache.completeFile).not.toHaveBeenCalled()
				await vi.advanceTimersByTimeAsync(delay - 1)
				expect(request).toHaveBeenCalledTimes(attempt)
				await vi.advanceTimersByTimeAsync(1)
				expect(request).toHaveBeenCalledTimes(attempt + 1)
			}
		} finally {
			controller.abort()
			await pending
		}
		expect(failures.list()).toEqual([])
	})

	it("recovers after a provider-requested wait without recording a failure", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: { message: "limited" } }), {
					status: 429,
					headers: { "content-type": "application/json", "retry-after": "60" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ data: [{ embedding: [1, 0] }], embeddings: [[1, 0]] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			)
		vi.stubGlobal("fetch", request)
		const { replace, failures, cache } = transportWriter()
		const pending = replace(createEmbedder())
		await vi.advanceTimersByTimeAsync(59_999)
		expect(request).toHaveBeenCalledOnce()
		expect(failures.list()).toEqual([])
		await vi.advanceTimersByTimeAsync(1)
		await pending
		expect(request).toHaveBeenCalledTimes(2)
		expect(failures.list()).toEqual([])
		expect(cache.completeFile).toHaveBeenCalledOnce()
	})

	it("aborts a provider wait without another transport request", async () => {
		const request = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: { message: "limited" } }), {
					status: 429,
					headers: { "content-type": "application/json", "retry-after": "60" },
				}),
		)
		vi.stubGlobal("fetch", request)
		const controller = new AbortController()
		const { replace, failures, pacers } = transportWriter()
		const pending = replace(createEmbedder(), controller.signal).catch((error: unknown) => error)
		await vi.advanceTimersByTimeAsync(0)
		expect(pacers.waitingPaths()).toEqual(["test.ts"])
		expect(failures.list()).toEqual([])
		controller.abort()
		expect(await pending).toMatchObject({ name: "AbortError" })
		await vi.advanceTimersByTimeAsync(120_000)
		expect(request).toHaveBeenCalledOnce()
		expect(failures.list()).toEqual([])
		expect(pacers.waitingPaths()).toEqual([])
	})
})
