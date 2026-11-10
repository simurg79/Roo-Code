import "../../__tests__/mock-code-index-log"
import { OpenAI } from "openai"
import { OpenAICompatibleEmbedder } from "../openai-compatible"
import { OpenRouterEmbedder } from "../openrouter"

vi.mock("openai")
vi.mock("../../../../i18n", () => ({ t: (key: string) => key }))

const factories = [
	["OpenAI-compatible", () => new OpenAICompatibleEmbedder("https://example.test/v1", "test-key")],
	["OpenRouter", () => new OpenRouterEmbedder("test-key")],
] as const

beforeEach(() => {
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe.each(factories)("%s rate-limit boundary", (_name, createEmbedder) => {
	it("does not delay a second instance after a rate-limit failure", async () => {
		const request = vi.fn()
		vi.mocked(OpenAI).mockImplementation(() => ({ embeddings: { create: request } }) as unknown as OpenAI)
		const cause = Object.assign(new Error("rate limited"), {
			status: 429,
			headers: new Headers({ "retry-after": "60" }),
		})
		request.mockRejectedValueOnce(cause).mockResolvedValueOnce({ data: [{ embedding: [0.25] }] })
		const first = createEmbedder()
		const second = createEmbedder()
		await expect(first.createEmbeddings(["first"])).rejects.toMatchObject({
			classification: "rate-limit",
			retryAfterMs: 60_000,
			cause,
		})
		await expect(second.createEmbeddings(["second"])).resolves.toMatchObject({ embeddings: [[0.25]] })
		expect(request).toHaveBeenCalledTimes(2)
		expect(vi.getTimerCount()).toBe(0)
		expect([...first.internallyRetriedClasses]).toEqual([])
		expect([...second.internallyRetriedClasses]).toEqual([])
	})
})
