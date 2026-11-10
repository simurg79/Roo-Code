import "../../__tests__/mock-code-index-log"
import { createServer } from "node:http"
import path from "node:path"
import type { AddressInfo } from "node:net"
import nock from "nock"
import { QdrantClientResourceExhaustedError } from "@qdrant/js-client-rest"
import { QdrantVectorStore } from "../qdrant-client"
import { classifyIndexingError, IndexingRetryError, VectorStoreError } from "../../shared/indexing-errors"
import { transportWriter } from "../../__tests__/transport-writer"
import type { IEmbedder } from "../../interfaces"

vi.mock("../../../../i18n", () => ({ t: (key: string) => key }))
const { waits } = vi.hoisted(() => ({ waits: vi.fn() }))
vi.mock("../../embedders/cancellation", () => ({
	waitForRetry: async (delay: number, signal?: AbortSignal) => {
		signal?.throwIfAborted()
		waits(delay)
	},
}))

const operations = ["upsert", "delete", "verify"] as const
const matchesOperation = (url: string, operation: (typeof operations)[number]) =>
	operation === "verify"
		? url.includes("/count")
		: operation === "delete"
			? url.includes("/delete")
			: /\/points\?/.test(url)

beforeEach(() => {
	waits.mockReset()
	nock.enableNetConnect("127.0.0.1")
	vi.spyOn(console, "error").mockImplementation(() => {})
	vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
	vi.restoreAllMocks()
	nock.disableNetConnect()
})

describe.each(operations)("Qdrant %s transport through writer and registry", (operation) => {
	it.each([429, "429-long", 503, 400, "connection"] as const)(
		"records %s and exact transport counts",
		async (scenario) => {
			const status = scenario === "429-long" ? 429 : scenario
			const retryAfter = scenario === "429-long" ? 61 : 7
			let requests = 0
			let healthComplete!: () => void
			const health = new Promise<void>((resolve) => {
				healthComplete = resolve
			})
			const bodies: Array<Record<string, any>> = []
			const server = createServer((request, response) => {
				response.setHeader("content-type", "application/json")
				if (request.url === "/") {
					response.end(JSON.stringify({ title: "qdrant", version: "1.15.0" }), healthComplete)
					return
				}
				const failedOperation = matchesOperation(request.url!, operation)
				if (failedOperation) requests++
				let body = ""
				request.on("data", (chunk) => {
					body += chunk
				})
				request.on("end", () => {
					const parsed = JSON.parse(body)
					if (failedOperation) bodies.push(parsed)
					if (failedOperation && status !== "connection") {
						response.writeHead(status, { "retry-after": String(retryAfter) })
						response.end(JSON.stringify({ status: { error: "failure" }, time: 0 }))
					} else {
						response.end(
							JSON.stringify({ result: { operation_id: 1, status: "completed" }, status: "ok", time: 0 }),
						)
					}
				})
			})
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
			const store = new QdrantVectorStore(path.resolve("/workspace"), endpoint, 2)
			await health
			let connectionRequests = 0
			if (status === "connection") {
				const closed = createServer()
				await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve))
				const port = (closed.address() as AddressInfo).port
				await new Promise<void>((resolve) => closed.close(() => resolve()))
				const fetch = globalThis.fetch
				vi.spyOn(globalThis, "fetch").mockImplementation((input, options) => {
					const url = input instanceof Request ? input.url : String(input)
					if (!matchesOperation(url, operation)) return fetch(input, options)
					connectionRequests++
					const target = new URL(url)
					target.port = String(port)
					return fetch(input instanceof Request ? new Request(target, input) : target, options)
				})
			}
			const { replace, failures, cache } = transportWriter(store)
			const embedder = { createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[1, 0]] }) }
			try {
				const error = await replace(embedder as unknown as IEmbedder).catch((error: unknown) => error)
				const classification =
					status === "connection"
						? "connection"
						: status === 429
							? "rate-limit"
							: status === 503
								? "server"
								: "permanent"
				const attempts = status === 400 ? 1 : 3
				const expectedRequests = attempts * (operation === "verify" ? 2 : 1)
				// Both concurrent count requests must settle before checking the transport total.
				await vi.waitFor(() =>
					expect(status === "connection" ? connectionRequests : requests).toBe(expectedRequests),
				)
				expect(error).toBeInstanceOf(IndexingRetryError)
				expect(error).toMatchObject({ attempts, activity: operation })
				expect((error as Error).cause).toBeInstanceOf(VectorStoreError)
				expect(classifyIndexingError(error)).toBe(classification)
				if (status !== "connection") expect(error).toMatchObject({ statusCode: status })
				if (status === 429) {
					expect(((error as Error).cause as Error).cause).toBeInstanceOf(QdrantClientResourceExhaustedError)
					expect(error).toMatchObject({ retryAfterMs: retryAfter * 1000 })
					expect(waits.mock.calls.map(([delay]) => delay)).toEqual(
						retryAfter === 7 ? [7000, 7000] : [500, 1000],
					)
					expect(failures.list()[0]).toMatchObject({
						retryAfterRefusedMs: retryAfter === 61 ? 61_000 : undefined,
					})
				}
				expect(failures.list()).toEqual([
					expect.objectContaining({
						path: "test.ts",
						activity: operation,
						classification,
						attempt: attempts,
						state: "exhausted",
					}),
				])
				expect(cache.completeFile).not.toHaveBeenCalled()
				expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
				if (operation === "delete" && status !== "connection") {
					for (const body of bodies)
						expect(body.filter.must[1].should[0]).toEqual({ key: "generation", range: { lt: 1 } })
				}
			} finally {
				server.closeAllConnections()
				await new Promise<void>((resolve) => server.close(() => resolve()))
			}
		},
	)
})

describe("T32 Qdrant Retry-After headers through real HTTP, store and writer", () => {
	const now = Date.parse("2026-11-10T12:00:00Z")
	it.each([
		{ scenario: "HTTP date 7 seconds ahead", header: new Date(now + 7000).toUTCString(), delay: 7000 },
		{ scenario: "HTTP date 61 seconds ahead", header: new Date(now + 61_000).toUTCString(), delay: 61_000 },
		{ scenario: "past HTTP date", header: new Date(now - 7000).toUTCString(), delay: undefined },
		{ scenario: "numeric 61 seconds", header: "61", delay: 61_000 },
		{ scenario: "missing header", header: undefined, delay: undefined },
	])("$scenario preserves rate-limit status and chooses bounded waits", async ({ header, delay }) => {
		vi.spyOn(Date, "now").mockReturnValue(now)
		let requests = 0
		let healthComplete!: () => void
		const health = new Promise<void>((resolve) => {
			healthComplete = resolve
		})
		const server = createServer((request, response) => {
			response.setHeader("content-type", "application/json")
			if (request.url === "/") {
				response.end(JSON.stringify({ title: "qdrant", version: "1.15.0" }), healthComplete)
				return
			}
			request.resume()
			request.on("end", () => {
				requests++
				response.writeHead(429, header === undefined ? {} : { "retry-after": header })
				response.end(JSON.stringify({ status: { error: "limited" }, time: 0 }))
			})
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		try {
			const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
			const store = new QdrantVectorStore(path.resolve("/workspace"), endpoint, 2)
			await health
			const { replace, failures, cache } = transportWriter(store)
			const waitingRequests: number[] = []
			waits.mockImplementation(() => {
				waitingRequests.push(requests)
				expect(failures.list()).toEqual([
					expect.objectContaining({
						path: "test.ts",
						activity: "upsert",
						classification: "rate-limit",
						attempt: requests,
						state: "retrying",
					}),
				])
			})
			const embedder = { createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[1, 0]] }) }
			const error = await replace(embedder as unknown as IEmbedder).catch((error: unknown) => error)
			expect(requests).toBe(3)
			expect(waitingRequests).toEqual([1, 2])
			expect(waits.mock.calls.map(([wait]) => wait)).toEqual(delay === 7000 ? [7000, 7000] : [500, 1000])
			expect(error).toBeInstanceOf(IndexingRetryError)
			expect(error).toMatchObject({
				classification: "rate-limit",
				statusCode: 429,
				attempts: 3,
				activity: "upsert",
			})
			expect((error as IndexingRetryError).retryAfterMs).toBe(delay)
			const storeError = (error as IndexingRetryError).cause as VectorStoreError
			expect(storeError).toBeInstanceOf(VectorStoreError)
			expect(storeError).toMatchObject({ classification: "rate-limit", statusCode: 429 })
			expect(storeError.retryAfterMs).toBe(delay)
			if (header === "61") {
				expect(storeError.cause).toBeInstanceOf(QdrantClientResourceExhaustedError)
				expect(storeError.cause).toMatchObject({ retry_after: 61 })
			} else {
				const rawError = storeError.cause as Error & { status: number; headers: Headers }
				expect(rawError).toBeInstanceOf(Error)
				expect(rawError).toMatchObject({ name: "Error", status: 429 })
				expect(rawError.headers.get("retry-after")).toBe(header ?? null)
				const reconstructed = new VectorStoreError("limited", rawError)
				expect(reconstructed).toMatchObject({ classification: "rate-limit", statusCode: 429 })
				expect(reconstructed.retryAfterMs).toBe(delay)
			}
			expect(classifyIndexingError(error)).toBe("rate-limit")
			expect(failures.list()).toEqual([
				expect.objectContaining({
					path: "test.ts",
					activity: "upsert",
					classification: "rate-limit",
					attempt: 3,
					state: "exhausted",
					retryAfterRefusedMs: delay === 61_000 ? 61_000 : undefined,
				}),
			])
			expect(cache.completeFile).not.toHaveBeenCalled()
			expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
		} finally {
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})
})
