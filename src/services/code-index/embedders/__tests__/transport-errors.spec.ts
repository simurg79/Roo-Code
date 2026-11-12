import "../../__tests__/mock-code-index-log"
import { createServer } from "node:http2"
import http2 from "node:http2"
import type { AddressInfo } from "node:net"
import nock from "nock"
import { OpenAiEmbedder } from "../openai"
import { OpenAICompatibleEmbedder } from "../openai-compatible"
import { OpenRouterEmbedder } from "../openrouter"
import { GeminiEmbedder } from "../gemini"
import { MistralEmbedder } from "../mistral"
import { VercelAiGatewayEmbedder } from "../vercel-ai-gateway"
import { CodeIndexOllamaEmbedder } from "../ollama"
import { BedrockEmbedder } from "../bedrock"
import { classifyIndexingError, EmbeddingError, IndexingRetryError } from "../../shared/indexing-errors"
import { pacedTransportWriter as transportWriter, waitForTransport } from "./paced-transport-writer"

vi.mock("../../../../api/providers/openai-native", () => ({
	OpenAiNativeHandler: class {
		constructor(protected options: unknown) {}
	},
}))
vi.mock("../../../../i18n", () => ({ t: (key: string) => key }))
const { waits } = vi.hoisted(() => ({ waits: vi.fn() }))
vi.mock("../cancellation", () => ({
	waitForRetry: async (delay: number, signal?: AbortSignal) => {
		signal?.throwIfAborted()
		waits(delay)
		vi.setSystemTime(Date.now() + delay)
	},
}))

const embeddingTransportFactories = [
	["openai", () => new OpenAiEmbedder({ openAiNativeApiKey: "test-key" })],
	["compatible-sdk", () => new OpenAICompatibleEmbedder("https://example.test/v1", "test-key")],
	["compatible-fetch", () => new OpenAICompatibleEmbedder("https://example.test/embeddings", "test-key")],
	["openrouter", () => new OpenRouterEmbedder("test-key")],
	["gemini", () => new GeminiEmbedder("test-key")],
	["mistral", () => new MistralEmbedder("test-key")],
	["vercel", () => new VercelAiGatewayEmbedder("test-key")],
	["ollama", () => new CodeIndexOllamaEmbedder({ ollamaBaseUrl: "https://example.test" })],
] as const

beforeEach(() => {
	waits.mockClear()
	vi.useFakeTimers({ toFake: ["Date"] })
	vi.setSystemTime(Date.now() + 1_000_000)
	vi.spyOn(console, "error").mockImplementation(() => {})
	vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	vi.unstubAllEnvs()
	nock.disableNetConnect()
})

describe.each(embeddingTransportFactories)("%s real transport boundary", (transport, createEmbedder) => {
	it.each([500, 503, 408, 409, 401])("preserves HTTP %s without SDK retry stacking", async (status) => {
		const request = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: { message: "failure" } }), {
					status,
					headers: { "content-type": "application/json" },
				}),
		)
		vi.stubGlobal("fetch", request)
		const embedder = createEmbedder()
		const { replace, failures, cache } = transportWriter()
		const error = await replace(embedder).catch((error: unknown) => error)
		const classification = status >= 500 ? "server" : "permanent"
		expect(error).toBeInstanceOf(IndexingRetryError)
		expect((error as Error).cause).toBeInstanceOf(EmbeddingError)
		expect(error).toMatchObject({ classification, statusCode: status })
		expect(classifyIndexingError(error)).toBe(classification)
		const attempts = status >= 500 ? 3 : 1
		expect(request).toHaveBeenCalledTimes(attempts)
		expect(failures.list()).toEqual([
			expect.objectContaining({
				path: "test.ts",
				activity: "embed",
				classification,
				attempt: attempts,
				state: "exhausted",
			}),
		])
		expect(cache.completeFile).not.toHaveBeenCalled()
	})

	it("preserves a fetch network rejection with no network code", async () => {
		const cause = new TypeError("fetch failed", { cause: new Error("network") })
		const request = vi.fn().mockRejectedValue(cause)
		vi.stubGlobal("fetch", request)
		const { replace, failures } = transportWriter()
		const error = await replace(createEmbedder()).catch((error: unknown) => error)
		expect(error).toBeInstanceOf(IndexingRetryError)
		expect((error as Error).cause).toBeInstanceOf(EmbeddingError)
		expect(classifyIndexingError(error)).toBe("connection")
		expect(request).toHaveBeenCalledTimes(3)
		expect(failures.list()[0]).toMatchObject({
			activity: "embed",
			classification: "connection",
			attempt: 3,
			state: "exhausted",
		})
	})

	it("ends an in-flight caller cancellation without another request", async () => {
		const controller = new AbortController()
		const request = vi.fn(async () => {
			controller.abort()
			throw controller.signal.reason
		})
		vi.stubGlobal("fetch", request)
		const { replace } = transportWriter()
		const error = await replace(createEmbedder(), controller.signal).catch((error: unknown) => error)
		expect(classifyIndexingError(error, controller.signal)).toBe("permanent")
		expect(request).toHaveBeenCalledTimes(1)
	})

	it("issues no transport request for caller cancellation", async () => {
		const request = vi.fn()
		vi.stubGlobal("fetch", request)
		const signal = AbortSignal.abort()
		const { replace } = transportWriter()
		const error = await replace(createEmbedder(), signal).catch((error: unknown) => error)
		expect(classifyIndexingError(error, signal)).toBe("permanent")
		expect(request).not.toHaveBeenCalled()
	})
})

it("classifies Ollama's own timeout as connection, not caller cancellation", async () => {
	let expireRequest!: () => void
	const timeout = vi.spyOn(globalThis, "setTimeout").mockImplementationOnce((callback) => {
		expireRequest = callback as () => void
		return 0 as unknown as ReturnType<typeof setTimeout>
	})
	const request = vi.fn(
		(_url: unknown, options: RequestInit) =>
			new Promise((_resolve, reject) => {
				options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })
			}),
	)
	vi.stubGlobal("fetch", request)
	const pending = new CodeIndexOllamaEmbedder({ ollamaBaseUrl: "https://example.test" })
		.createEmbeddings(["test"])
		.catch((error: unknown) => error)
	expect(timeout).toHaveBeenCalledWith(expect.any(Function), 60_000)
	expireRequest()
	const error = await pending
	expect(error).toBeInstanceOf(EmbeddingError)
	expect(classifyIndexingError(error)).toBe("connection")
	expect(request).toHaveBeenCalledTimes(1)
})

describe("Bedrock real HTTP/2 transport boundary", () => {
	it("T25 paces four HTTP/2 throttles without exhaustion and then completes", async () => {
		const startTime = Date.now()
		vi.useRealTimers()
		vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
		vi.setSystemTime(startTime)
		vi.spyOn(Math, "random").mockReturnValue(0)
		let requests = 0
		const server = createServer()
		server.on("stream", (stream) => {
			requests++
			if (requests <= 4) {
				stream.respond({
					":status": 429,
					"content-type": "application/json",
					"x-amzn-errortype": "ThrottlingException",
				})
				stream.end(JSON.stringify({ message: "limited", __type: "ThrottlingException" }))
			} else {
				stream.respond({ ":status": 200, "content-type": "application/json" })
				stream.end(JSON.stringify({ embedding: [1, 0], inputTextTokenCount: 1 }))
			}
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		configureCredentials(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
		const embedder = new BedrockEmbedder("us-east-1")
		const controller = new AbortController()
		const { replace, failures, cache, pacers } = transportWriter()
		const pending = replace(embedder, controller.signal).catch((error: unknown) => error)
		try {
			for (const [index, delay] of [500, 1000, 2000, 4000].entries()) {
				await waitForTransport(() => {
					expect(requests).toBe(index + 1)
					expect(pacers.get(embedder.rateLimitScope).state().pausedUntil).toBe(Date.now() + delay)
					expect(pacers.get(embedder.rateLimitScope).state().waitingPaths).toEqual(["test.ts"])
				})
				expect(failures.list()).toEqual([])
				vi.advanceTimersByTime(delay - 1)
				expect(requests).toBe(index + 1)
				vi.advanceTimersByTime(1)
			}
			await pending
			expect(requests).toBe(5)
			expect(failures.list()).toEqual([])
			expect(cache.completeFile).toHaveBeenCalledOnce()
		} finally {
			controller.abort()
			await pending
			;(embedder as unknown as { bedrockClient: { destroy(): void } }).bedrockClient.destroy()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})

	function configureCredentials(endpoint: string) {
		vi.stubEnv("AWS_ACCESS_KEY_ID", "test-access-key")
		vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret-key")
		vi.stubEnv("AWS_ENDPOINT_URL_BEDROCK_RUNTIME", endpoint)
		nock.enableNetConnect("127.0.0.1")
	}

	it.each([
		[500, "InternalServerException", "server"],
		[503, "ServiceUnavailableException", "server"],
		[400, "ValidationException", "permanent"],
	] as const)("preserves HTTP %s without AWS retry stacking", async (status, exception, classification) => {
		let requests = 0
		const server = createServer()
		server.on("stream", (stream) => {
			requests++
			stream.respond({ ":status": status, "content-type": "application/json", "x-amzn-errortype": exception })
			stream.end(JSON.stringify({ message: "failure", __type: exception }))
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		configureCredentials(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
		const embedder = new BedrockEmbedder("us-east-1")
		try {
			const { replace, failures } = transportWriter()
			const error = await replace(embedder).catch((error: unknown) => error)
			expect(error).toBeInstanceOf(IndexingRetryError)
			expect((error as Error).cause).toBeInstanceOf(EmbeddingError)
			expect(error).toMatchObject({ classification, statusCode: status })
			const attempts = status >= 500 ? 3 : 1
			expect(requests).toBe(attempts)
			expect(failures.list()[0]).toMatchObject({
				path: "test.ts",
				activity: "embed",
				classification,
				attempt: attempts,
				state: "exhausted",
			})
		} finally {
			;(embedder as unknown as { bedrockClient: { destroy(): void } }).bedrockClient.destroy()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})

	it("issues no HTTP/2 connection for an aborted signal", async () => {
		configureCredentials("http://127.0.0.1:1")
		const connection = vi.spyOn(http2, "connect")
		const signal = AbortSignal.abort()
		const { replace } = transportWriter()
		const error = await replace(new BedrockEmbedder("us-east-1"), signal).catch((error: unknown) => error)
		expect(classifyIndexingError(error, signal)).toBe("permanent")
		expect(connection).not.toHaveBeenCalled()
	})

	it("ends an in-flight HTTP/2 cancellation without another request", async () => {
		const controller = new AbortController()
		const server = createServer()
		let requests = 0
		server.on("stream", (stream) => {
			requests++
			stream.on("error", () => {})
			controller.abort()
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		configureCredentials(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
		const embedder = new BedrockEmbedder("us-east-1")
		try {
			const { replace } = transportWriter()
			const error = await replace(embedder, controller.signal).catch((error: unknown) => error)
			expect(classifyIndexingError(error, controller.signal)).toBe("permanent")
			expect(requests).toBe(1)
		} finally {
			;(embedder as unknown as { bedrockClient: { destroy(): void } }).bedrockClient.destroy()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})

	it("counts HTTP/2 connection attempts, not server requests, on connection refusal", async () => {
		const server = createServer()
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		const port = (server.address() as AddressInfo).port
		await new Promise<void>((resolve) => server.close(() => resolve()))
		configureCredentials(`http://127.0.0.1:${port}`)
		const connection = vi.spyOn(http2, "connect")
		const embedder = new BedrockEmbedder("us-east-1")
		try {
			const { replace, failures } = transportWriter()
			const error = await replace(embedder).catch((error: unknown) => error)
			expect(classifyIndexingError(error)).toBe("connection")
			expect(connection).toHaveBeenCalledTimes(3)
			expect(failures.list()[0]).toMatchObject({
				activity: "embed",
				classification: "connection",
				attempt: 3,
				state: "exhausted",
			})
		} finally {
			;(embedder as unknown as { bedrockClient: { destroy(): void } }).bedrockClient.destroy()
		}
	})
})
