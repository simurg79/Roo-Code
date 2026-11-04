import "../../__tests__/mock-code-index-log"
import { OpenAiEmbedder } from "../openai"
import { OpenAICompatibleEmbedder } from "../openai-compatible"
import { OpenRouterEmbedder } from "../openrouter"
import { GeminiEmbedder } from "../gemini"
import { MistralEmbedder } from "../mistral"
import { VercelAiGatewayEmbedder } from "../vercel-ai-gateway"
import { CodeIndexOllamaEmbedder } from "../ollama"
import { BedrockEmbedder } from "../bedrock"
import type { IEmbedder } from "../../interfaces/embedder"
import { waitForRetry } from "../cancellation"

const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock("openai", () => ({
	OpenAI: vi.fn().mockImplementation(() => ({ embeddings: { create: request } })),
}))
vi.mock("../../../../api/providers/openai-native", () => ({
	OpenAiNativeHandler: class {
		constructor(protected options: object) {}
	},
}))
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
	BedrockRuntimeClient: vi.fn().mockImplementation(() => ({ send: request })),
	InvokeModelCommand: vi.fn().mockImplementation((input) => ({ input })),
}))
vi.mock("@aws-sdk/credential-providers", () => ({
	fromIni: vi.fn(),
	fromNodeProviderChain: vi.fn(),
}))
vi.mock("../../../../i18n", () => ({ t: (key: string) => key }))
vi.mock("../../../../shared/embeddingModels", () => ({
	getDefaultModelId: () => "test-model",
	getModelQueryPrefix: () => "",
}))
vi.mock("../../constants", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../constants")>()),
	MAX_BATCH_TOKENS: 4,
}))

type Provider = {
	name: string
	create: () => IEmbedder
	transport: "sdk" | "fetch" | "ollama" | "bedrock"
}

const providers: Provider[] = [
	{ name: "OpenAI", create: () => new OpenAiEmbedder({ openAiNativeApiKey: "test-key" }), transport: "sdk" },
	{
		name: "OpenAI-compatible",
		create: () => new OpenAICompatibleEmbedder("https://example.test/v1", "test-key"),
		transport: "sdk",
	},
	{ name: "OpenRouter", create: () => new OpenRouterEmbedder("test-key"), transport: "sdk" },
	{ name: "Gemini", create: () => new GeminiEmbedder("test-key"), transport: "sdk" },
	{ name: "Mistral", create: () => new MistralEmbedder("test-key"), transport: "sdk" },
	{ name: "Vercel", create: () => new VercelAiGatewayEmbedder("test-key"), transport: "sdk" },
	{ name: "Ollama", create: () => new CodeIndexOllamaEmbedder({}), transport: "ollama" },
	{ name: "Bedrock", create: () => new BedrockEmbedder("us-east-1"), transport: "bedrock" },
	{
		name: "OpenAI-compatible direct fetch",
		create: () => new OpenAICompatibleEmbedder("https://example.test/v1/embeddings", "test-key"),
		transport: "fetch",
	},
]

function deferred<Value>() {
	let resolve!: (value: Value) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

function successfulResponse(transport: Provider["transport"]) {
	const data = { data: [{ embedding: [0.25, 0.5] }], embeddings: [[0.25, 0.5]] }
	if (transport === "fetch" || transport === "ollama") {
		return { ok: true, json: async () => data }
	}
	if (transport === "bedrock") {
		return { body: new TextEncoder().encode(JSON.stringify({ embedding: [0.25, 0.5] })) }
	}
	return data
}

beforeEach(() => {
	vi.useFakeTimers()
	request.mockReset()
	vi.stubGlobal("fetch", request)
	vi.spyOn(console, "warn").mockImplementation(() => {})
	vi.spyOn(console, "error").mockImplementation(() => {})
	for (const embedderClass of [OpenAICompatibleEmbedder, OpenRouterEmbedder]) {
		Object.assign(Reflect.get(embedderClass, "globalRateLimitState"), {
			isRateLimited: false,
			rateLimitResetTime: 0,
			consecutiveRateLimitErrors: 0,
			lastRateLimitError: 0,
		})
	}
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
	vi.useRealTimers()
})

describe.each(providers)("$name cancellation", ({ create, transport }) => {
	it("forwards the caller signal to the transport", async () => {
		const controller = new AbortController()
		request.mockResolvedValue(successfulResponse(transport))
		await create().createEmbeddings(["first"], undefined, controller.signal)
		const options = request.mock.calls[0][1]
		if (transport === "bedrock") {
			expect(options.abortSignal).toBe(controller.signal)
		} else if (transport === "ollama") {
			expect(options.signal.aborted).toBe(false)
			controller.abort()
			expect(options.signal.aborted).toBe(true)
			expect(options.signal.reason).toBe(controller.signal.reason)
		} else {
			expect(options.signal).toBe(controller.signal)
		}
	})

	it("refuses an already-aborted call without issuing a request", async () => {
		const controller = new AbortController()
		controller.abort()
		await expect(create().createEmbeddings(["first"], undefined, controller.signal)).rejects.toBe(
			controller.signal.reason,
		)
		expect(request).not.toHaveBeenCalled()
	})

	it.each(["success", "failure", "cancellation-error"])(
		"discards late %s and issues no queued batch or item",
		async (outcome) => {
			const controller = new AbortController()
			const pending = deferred<unknown>()
			const started = deferred<void>()
			request.mockImplementation(() => {
				started.resolve()
				return pending.promise
			})
			const result = create().createEmbeddings(["first123", "second12", "third123"], undefined, controller.signal)
			await started.promise
			controller.abort()
			const requestOptions = request.mock.calls[0][1]
			const forwardedSignal = transport === "bedrock" ? requestOptions.abortSignal : requestOptions.signal
			expect(forwardedSignal.aborted).toBe(true)
			expect(forwardedSignal.reason).toBe(controller.signal.reason)
			if (outcome === "success") {
				pending.resolve(successfulResponse(transport))
			} else {
				pending.reject(
					outcome === "failure" ? new Error("Late failure") : new DOMException("Late abort", "AbortError"),
				)
			}
			await expect(result).rejects.toBe(controller.signal.reason)
			expect(request).toHaveBeenCalledTimes(1)
			expect(vi.getTimerCount()).toBe(0)
		},
	)
})

describe("retry cancellation", () => {
	it.each(providers.filter(({ name }) => ["OpenAI", "OpenAI-compatible", "OpenRouter", "Bedrock"].includes(name)))(
		"$name cancels backoff without another request",
		async ({ create }) => {
			const controller = new AbortController()
			const error = Object.assign(new Error("Rate limited"), { status: 429, name: "ThrottlingException" })
			request.mockRejectedValue(error)
			const result = create().createEmbeddings(["first"], undefined, controller.signal)
			await vi.advanceTimersByTimeAsync(0)
			expect(request).toHaveBeenCalledTimes(1)
			expect(vi.getTimerCount()).toBe(1)
			controller.abort()
			await expect(result).rejects.toBe(controller.signal.reason)
			expect(vi.getTimerCount()).toBe(0)
			await vi.runAllTimersAsync()
			expect(request).toHaveBeenCalledTimes(1)
		},
	)

	it.each([OpenAICompatibleEmbedder, OpenRouterEmbedder])(
		"cancels a request queued behind a global rate limit",
		async (Embedder) => {
			const embedder =
				Embedder === OpenAICompatibleEmbedder
					? new OpenAICompatibleEmbedder("https://example.test/v1", "test-key")
					: new OpenRouterEmbedder("test-key")
			const firstController = new AbortController()
			request.mockRejectedValue(Object.assign(new Error("Rate limited"), { status: 429 }))
			const firstResult = embedder.createEmbeddings(["first"], undefined, firstController.signal)
			await vi.advanceTimersByTimeAsync(0)
			const queuedController = new AbortController()
			const queuedResult = embedder.createEmbeddings(["second"], undefined, queuedController.signal)
			await vi.advanceTimersByTimeAsync(0)
			expect(vi.getTimerCount()).toBe(2)
			queuedController.abort()
			await expect(queuedResult).rejects.toBe(queuedController.signal.reason)
			firstController.abort()
			await expect(firstResult).rejects.toBe(firstController.signal.reason)
			await vi.runAllTimersAsync()
			expect(request).toHaveBeenCalledTimes(1)
		},
	)
})

describe("cancellable wait", () => {
	it("refuses a previously aborted signal", () => {
		const controller = new AbortController()
		controller.abort()
		expect(() => waitForRetry(100, controller.signal)).toThrow(controller.signal.reason)
		expect(vi.getTimerCount()).toBe(0)
	})

	it("removes its abort listener when the wait completes", async () => {
		const controller = new AbortController()
		const removeListener = vi.spyOn(controller.signal, "removeEventListener")
		const result = waitForRetry(100, controller.signal)
		await vi.advanceTimersByTimeAsync(100)
		await result
		expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function))
		expect(vi.getTimerCount()).toBe(0)
	})
})

it("Ollama keeps its timeout when a caller signal is supplied and cleans up after rejection", async () => {
	const controller = new AbortController()
	request.mockImplementation(
		(_url, options) =>
			new Promise((_resolve, reject) => {
				options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })
			}),
	)
	const result = new CodeIndexOllamaEmbedder({}).createEmbeddings(["first"], undefined, controller.signal)
	const assertion = expect(result).rejects.toThrow("embeddings:validation.connectionFailed")
	await vi.advanceTimersByTimeAsync(60_000)
	await assertion
	expect(controller.signal.aborted).toBe(false)
	expect(request.mock.calls[0][1].signal.aborted).toBe(true)
	expect(vi.getTimerCount()).toBe(0)
})
