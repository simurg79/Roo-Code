import "../../__tests__/mock-code-index-log"
import { OpenAICompatibleEmbedder } from "../openai-compatible"
import { CodeIndexOllamaEmbedder } from "../ollama"
import { transportWriter } from "../../__tests__/transport-writer"

vi.mock("../../../../i18n", () => ({ t: (key: string) => key }))

const factories = [
	["compatible SDK", () => new OpenAICompatibleEmbedder("https://example.test/v1", "test-key")],
	["compatible fetch", () => new OpenAICompatibleEmbedder("https://example.test/embeddings", "test-key")],
	["Ollama", () => new CodeIndexOllamaEmbedder({ ollamaBaseUrl: "https://example.test" })],
] as const

beforeEach(() => {
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe.each(factories)("%s workflow delay", (_name, createEmbedder) => {
	it("keeps recovery visible and cancels a provider-requested wait without another request", async () => {
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
		expect(request).toHaveBeenCalledTimes(1)
		expect(failures.list()[0]).toMatchObject({ classification: "rate-limit", attempt: 1, state: "retrying" })
		await vi.advanceTimersByTimeAsync(59_999)
		expect(request).toHaveBeenCalledTimes(1)
		controller.abort()
		await pending
		await vi.runAllTimersAsync()
		expect(request).toHaveBeenCalledTimes(1)
		expect(failures.list()[0].state).toBe("exhausted")
		expect(vi.getTimerCount()).toBe(0)
	})
})
