import "./mock-code-index-log"
import { OpenAICompatibleEmbedder } from "../embedders/openai-compatible"
import { CodeIndexOllamaEmbedder } from "../embedders/ollama"
import { transportWriter } from "./transport-writer"

vi.mock("../../../i18n", () => ({ t: (key: string) => key }))

beforeEach(() => {
	vi.useFakeTimers()
	vi.setSystemTime(new Date("2026-11-10T12:00:00Z"))
})
afterEach(() => {
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
		["seconds", "2", 2000, undefined],
		["seconds", "60", 60_000, undefined],
		["seconds", "61", 500, 61_000],
		["milliseconds", "60001", 500, 60_001],
		["milliseconds", "2500", 2500, undefined],
		["date", "5", 5000, undefined],
		["date", "61", 500, 61_000],
		["date", "-5", 500, undefined],
		["seconds", "invalid", 500, undefined],
	] as const)("waits for %s %s", async (kind, value, firstDelay, retryAfterRefusedMs) => {
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
		const { replace, failures } = transportWriter()
		const pending = replace(createEmbedder()).catch((error: unknown) => error)
		await vi.advanceTimersByTimeAsync(0)
		expect(failures.list()[0]).toMatchObject({
			state: "retrying",
			delayMs: firstDelay,
			retryAfterRefusedMs,
			delaySource: firstDelay > 500 ? "provider" : "default",
		})
		await vi.advanceTimersByTimeAsync(firstDelay - 1)
		expect(request).toHaveBeenCalledOnce()
		expect(failures.list()[0].state).toBe("retrying")
		await vi.advanceTimersByTimeAsync(1)
		expect(request).toHaveBeenCalledTimes(2)
		const secondDelay = Math.max(1000, firstDelay)
		await vi.advanceTimersByTimeAsync(secondDelay - 1)
		expect(request).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(1)
		expect(await pending).toMatchObject({ attempts: 3, classification: "rate-limit" })
		expect(request).toHaveBeenCalledTimes(3)
		expect(failures.list()[0].state).toBe("exhausted")
	})

	it("recovers after a provider-requested wait and clears the failure", async () => {
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
		expect(failures.list()[0].state).toBe("retrying")
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
		const { replace, failures } = transportWriter()
		const pending = replace(createEmbedder(), controller.signal).catch((error: unknown) => error)
		await vi.advanceTimersByTimeAsync(0)
		expect(failures.list()[0].state).toBe("retrying")
		controller.abort()
		expect(await pending).toMatchObject({ name: "AbortError" })
		await vi.advanceTimersByTimeAsync(120_000)
		expect(request).toHaveBeenCalledOnce()
		expect(failures.list()[0].state).toBe("exhausted")
	})
})
