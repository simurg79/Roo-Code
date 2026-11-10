import { retryWithPolicy, type RetryFailure } from "../retry-policy"
import { EmbeddingError, IndexingRetryError } from "../indexing-errors"
import { APIUserAbortError } from "openai"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it.each([
	[undefined, [500, 1000], "default", undefined],
	[100, [500, 1000], "default", undefined],
	[2000, [2000, 2000], "provider", undefined],
	[60_000, [60_000, 60_000], "provider", undefined],
	[60_001, [500, 1000], "default", 60_001],
	[NaN, [500, 1000], "default", undefined],
	[-1, [500, 1000], "default", undefined],
] as const)("bounds provider delay %s", async (retryAfterMs, delays, delaySource, refused) => {
	const request = vi.fn().mockRejectedValue(new EmbeddingError("limited", { status: 429 }, { retryAfterMs }))
	const failures: RetryFailure[] = []
	const pending = retryWithPolicy(request, { onFailure: (failure) => failures.push(failure) }).catch((error) => error)
	await vi.advanceTimersByTimeAsync(0)
	for (const [index, delay] of delays.entries()) {
		expect(request).toHaveBeenCalledTimes(index + 1)
		expect(failures[index]).toMatchObject({ delayMs: delay, delaySource, retryAfterRefusedMs: refused })
		await vi.advanceTimersByTimeAsync(delay - 1)
		expect(request).toHaveBeenCalledTimes(index + 1)
		await vi.advanceTimersByTimeAsync(1)
	}
	expect(await pending).toMatchObject({ attempts: 3, classification: "rate-limit" })
	expect(request).toHaveBeenCalledTimes(3)
})

it("aborts a long wait without another request", async () => {
	const controller = new AbortController()
	const request = vi.fn().mockRejectedValue(new EmbeddingError("limited", { status: 429 }, { retryAfterMs: 60_000 }))
	const pending = retryWithPolicy(request, { signal: controller.signal }).catch((error) => error)
	await vi.advanceTimersByTimeAsync(0)
	controller.abort()
	expect(await pending).toBe(controller.signal.reason)
	await vi.advanceTimersByTimeAsync(120_000)
	expect(request).toHaveBeenCalledOnce()
})

it.each([401, 408, 409, 429])("does not retry permanent or owned HTTP %s", async (status) => {
	const request = vi.fn().mockRejectedValue(new EmbeddingError("failed", { status }))
	await expect(retryWithPolicy(request, { ownedClasses: new Set(["rate-limit"]) })).rejects.toMatchObject({
		attempts: 1,
	})
	expect(request).toHaveBeenCalledOnce()
})

it("returns a successful value and never issues an aborted first request", async () => {
	const request = vi.fn().mockResolvedValue("result")
	await expect(retryWithPolicy(request)).resolves.toBe("result")
	await expect(retryWithPolicy(request, { signal: AbortSignal.abort() })).rejects.toMatchObject({
		name: "AbortError",
	})
	expect(request).toHaveBeenCalledOnce()
})

it("shares two retries across successful batches without charging their first calls", async () => {
	const budget = { retriesUsed: 0 }
	const request = vi.fn().mockResolvedValue("result")
	await retryWithPolicy(request, { budget })
	await retryWithPolicy(request, { budget })
	expect(budget.retriesUsed).toBe(0)
	request.mockRejectedValueOnce({ status: 503 }).mockRejectedValueOnce({ status: 503 })
	const recovered = retryWithPolicy(request, { budget })
	await vi.advanceTimersByTimeAsync(1500)
	await recovered
	expect(budget.retriesUsed).toBe(2)
	request.mockRejectedValue({ status: 503 })
	await expect(retryWithPolicy(request, { budget })).rejects.toMatchObject({ attempts: 3 })
	expect(request).toHaveBeenCalledTimes(6)
})

it("T33 wraps a frozen error without changing its metadata", async () => {
	const original = Object.freeze(new EmbeddingError("limited", { status: 429 }, { retryAfterMs: 2000 }))
	const properties = Object.getOwnPropertyDescriptors(original)
	const request = vi.fn().mockRejectedValue(original)
	const pending = retryWithPolicy(request, { activity: "embed" }).catch((error) => error)
	await vi.advanceTimersByTimeAsync(4000)
	const error = await pending
	expect(error).toBeInstanceOf(IndexingRetryError)
	expect(error).toMatchObject({
		message: original.message,
		attempts: 3,
		classification: "rate-limit",
		statusCode: 429,
		retryAfterMs: 2000,
		activity: "embed",
	})
	expect((error as IndexingRetryError).cause).toBe(original)
	expect(Object.getOwnPropertyDescriptors(original)).toEqual(properties)
	expect(request).toHaveBeenCalledTimes(3)
})

it("T33 keeps independent metadata when one error is reused across operations", async () => {
	const original = Object.assign(new Error("unavailable"), { status: 503 })
	const properties = Object.getOwnPropertyDescriptors(original)
	const request = vi.fn().mockRejectedValue(original)
	const firstPending = retryWithPolicy(request, { activity: "upsert" }).catch((error) => error)
	await vi.advanceTimersByTimeAsync(1500)
	const first = await firstPending
	const second = await retryWithPolicy(request, { activity: "verify", budget: { retriesUsed: 2 } }).catch(
		(error) => error,
	)
	expect(first).toBeInstanceOf(IndexingRetryError)
	expect(second).toBeInstanceOf(IndexingRetryError)
	expect(first).not.toBe(second)
	expect(first).toMatchObject({ attempts: 3, activity: "upsert", classification: "server", statusCode: 503 })
	expect(second).toMatchObject({ attempts: 3, activity: "verify", classification: "server", statusCode: 503 })
	expect((first as IndexingRetryError).cause).toBe(original)
	expect((second as IndexingRetryError).cause).toBe(original)
	expect(Object.getOwnPropertyDescriptors(original)).toEqual(properties)
	expect(original).not.toHaveProperty("attempts")
	expect(original).not.toHaveProperty("activity")
})

it.each([
	new DOMException("cancelled", "AbortError"),
	new APIUserAbortError(),
	Object.freeze(Object.assign(new Error("cancelled"), { name: "APIUserAbortError" })),
])("T33 preserves live-signal cancellation identity: %s", async (original) => {
	const properties = Object.getOwnPropertyDescriptors(original)
	const request = vi.fn().mockRejectedValue(original)
	const onFailure = vi.fn()
	await expect(
		retryWithPolicy(request, { signal: new AbortController().signal, activity: "embed", onFailure }),
	).rejects.toBe(original)
	expect(Object.getOwnPropertyDescriptors(original)).toEqual(properties)
	expect(original).not.toHaveProperty("attempts")
	expect(original).not.toHaveProperty("activity")
	expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ classification: "permanent", willRetry: false }))
	expect(request).toHaveBeenCalledOnce()
})

it("T33 rethrows signal.reason rather than an operation rejection after abort", async () => {
	const controller = new AbortController()
	const reason = Object.freeze(new DOMException("stopped", "AbortError"))
	const rejection = new Error("operation rejected")
	const request = vi.fn(async () => {
		controller.abort(reason)
		throw rejection
	})
	const onFailure = vi.fn()
	await expect(retryWithPolicy(request, { signal: controller.signal, activity: "embed", onFailure })).rejects.toBe(
		controller.signal.reason,
	)
	expect(reason.name).toBe("AbortError")
	expect(reason).not.toHaveProperty("attempts")
	expect(reason).not.toHaveProperty("activity")
	expect(rejection).not.toHaveProperty("attempts")
	expect(rejection).not.toHaveProperty("activity")
	expect(onFailure).not.toHaveBeenCalled()
	expect(request).toHaveBeenCalledOnce()
})
