import "../../__tests__/mock-code-index-log"
import path from "node:path"
import { QdrantVectorStore } from "../qdrant-client"
import { transportWriter } from "../../__tests__/transport-writer"
import type { IEmbedder } from "../../interfaces"

vi.mock("../../../../i18n", () => ({ t: (key: string) => key }))
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

it.each([
	["upsert", 7],
	["delete", 7],
	["verify", 7],
	["upsert", 61],
	["delete", 61],
	["verify", 61],
] as const)("T26 %s honours or refuses %s seconds through the real client", async (activity, seconds) => {
	const requests = vi.fn()
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = input instanceof Request ? input.url : String(input)
			const matches =
				activity === "verify"
					? url.includes("/count")
					: activity === "delete"
						? url.includes("/delete")
						: /\/points\?/.test(url)
			if (matches) requests()
			return new Response(
				JSON.stringify(
					matches
						? { status: { error: "limited" }, time: 0 }
						: url.endsWith("/")
							? { title: "qdrant", version: "1.15.0" }
							: { result: { status: "completed", operation_id: 1 }, status: "ok", time: 0 },
				),
				{
					status: matches ? 429 : 200,
					headers: { "content-type": "application/json", "retry-after": String(seconds) },
				},
			)
		}),
	)
	const store = new QdrantVectorStore(path.resolve("/workspace"), "http://example.test:6333", 2)
	const { replace, failures } = transportWriter(store)
	const embedder = { createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[1, 0]] }) } as unknown as IEmbedder
	const pending = replace(embedder).catch((error: unknown) => error)
	await vi.advanceTimersByTimeAsync(0)
	const perAttempt = activity === "verify" ? 2 : 1
	const delays = seconds === 7 ? [7000, 7000] : [500, 1000]
	for (const [index, delayMs] of delays.entries()) {
		expect(requests).toHaveBeenCalledTimes((index + 1) * perAttempt)
		expect(failures.list()[0]).toMatchObject({
			state: "retrying",
			delayMs,
			delaySource: seconds === 7 ? "provider" : "default",
			retryAfterRefusedMs: seconds === 61 ? 61_000 : undefined,
		})
		await vi.advanceTimersByTimeAsync(delayMs - 1)
		expect(requests).toHaveBeenCalledTimes((index + 1) * perAttempt)
		await vi.advanceTimersByTimeAsync(1)
	}
	expect(await pending).toMatchObject({ retryAfterMs: seconds * 1000, attempts: 3 })
	expect(requests).toHaveBeenCalledTimes(3 * perAttempt)
	expect(failures.list()[0]).toMatchObject({ activity, classification: "rate-limit", state: "exhausted" })
})
