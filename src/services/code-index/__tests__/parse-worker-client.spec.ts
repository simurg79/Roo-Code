import { EventEmitter } from "node:events"
import { Worker } from "node:worker_threads"
import { ParseWorkerClient, type ParseRequest } from "../parse-worker-client"

class MockWorker extends EventEmitter {
	requests: ParseRequest[] = []
	terminate = vi.fn().mockResolvedValue(0)
	postMessage(request: ParseRequest): void {
		this.requests.push(request)
	}
}

const options = {
	content: "function example() { return 'a sufficiently long function body for indexing'; }",
	fileHash: "hash",
}

async function drain(): Promise<void> {
	for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

describe("ParseWorkerClient", () => {
	afterEach(() => vi.useRealTimers())

	it("interrupts an actual busy worker while the main event loop keeps running", async () => {
		const worker = new Worker(
			"require('node:worker_threads').parentPort.on('message', () => { while (true) {} })",
			{ eval: true },
		)
		const client = new ParseWorkerClient(() => worker, 200)
		const exited = new Promise<void>((resolve) => worker.once("exit", () => resolve()))
		const started = performance.now()
		const pending = client.parseFile("busy.ts", options).catch((error) => error)
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(performance.now() - started).toBeLessThan(500)
		expect(await pending).toMatchObject({ category: "parse-timeout" })
		await exited
		expect(performance.now() - started).toBeLessThan(2000)
	})

	it("dispatches FIFO and starts each deadline at dispatch, not enqueue", async () => {
		vi.useFakeTimers()
		const worker = new MockWorker()
		const client = new ParseWorkerClient(() => worker, 100)
		const first = client.parseFile("first.ts", options)
		const second = client.parseFile("second.ts", options)
		await drain()
		expect(worker.requests.map((request) => request.filePath)).toEqual(["first.ts"])
		await vi.advanceTimersByTimeAsync(90)
		worker.emit("message", { id: worker.requests[0].id, blocks: [] })
		await first
		await vi.advanceTimersByTimeAsync(90)
		expect(worker.terminate).not.toHaveBeenCalled()
		worker.emit("message", { id: worker.requests[1].id, blocks: [] })
		await second
		client.stop()
	})

	it.each(["Aborted()", "memory access out of bounds", "error", "exit", "hang"])(
		"contains %s and terminally rejects queued work",
		async (failure) => {
			vi.useFakeTimers()
			const worker = new MockWorker()
			const client = new ParseWorkerClient(() => worker, 100)
			const active = client.parseFile("bad.ts", options).catch((error) => error)
			const queued = client.parseFile("queued.ts", options).catch((error) => error)
			await drain()
			if (failure === "hang") await vi.advanceTimersByTimeAsync(100)
			else if (failure === "error") worker.emit("error", new Error("crash"))
			else if (failure === "exit") worker.emit("exit", 1)
			else worker.emit("message", { id: worker.requests[0].id, error: { message: failure, fatal: false } })
			expect(await active).toMatchObject({
				name: "ParserFatalError",
				filePath: "bad.ts",
				category: failure === "hang" ? "parse-timeout" : "parser-abort",
			})
			expect(await queued).toMatchObject({ name: "AbortError" })
			await expect(client.parseFile("later.md", options)).rejects.toMatchObject({ name: "AbortError" })
			expect(worker.requests).toHaveLength(1)
			expect(worker.terminate).toHaveBeenCalledTimes(1)
		},
	)

	it("removes a cancelled queue entry without stopping another caller", async () => {
		const worker = new MockWorker()
		const client = new ParseWorkerClient(() => worker)
		const controller = new AbortController()
		const first = client.parseFile("first.ts", options)
		const cancelled = client
			.parseFile("cancelled.ts", { ...options, signal: controller.signal })
			.catch((error) => error)
		const last = client.parseFile("last.ts", options)
		await drain()
		controller.abort()
		expect(await cancelled).toMatchObject({ name: "AbortError" })
		worker.emit("message", { id: worker.requests[0].id, blocks: [] })
		await first
		expect(worker.requests[1].filePath).toBe("last.ts")
		worker.emit("message", { id: worker.requests[1].id, blocks: [] })
		await last
		client.stop()
	})

	it.each(["stop", "abort"])(
		"%s synchronously settles active and queued requests without waiting for termination",
		async (action) => {
			const worker = new MockWorker()
			worker.terminate.mockReturnValue(new Promise(() => {}))
			const client = new ParseWorkerClient(() => worker)
			const controller = new AbortController()
			const active = client
				.parseFile("active.ts", { ...options, signal: controller.signal })
				.catch((error) => error)
			const queued = client.parseFile("queued.ts", options).catch((error) => error)
			await drain()
			if (action === "stop") client.stop()
			else controller.abort()
			expect(await active).toMatchObject({ name: "AbortError" })
			expect(await queued).toMatchObject({ name: "AbortError" })
			client.stop()
			expect(worker.terminate).toHaveBeenCalledTimes(1)
		},
	)

	// Spec FR6 / design Decision 3: a worker crash is a parser failure, even when no request is in flight.
	it.each(["error", "exit"])("reports an idle worker %s as a parser failure on the next parse", async (failure) => {
		const worker = new MockWorker()
		const client = new ParseWorkerClient(() => worker)
		const first = client.parseFile("first.ts", options)
		await drain()
		worker.emit("message", { id: worker.requests[0].id, blocks: [] })
		await first
		if (failure === "error") worker.emit("error", new Error("crash"))
		else worker.emit("exit", 1)
		await expect(client.parseFile("next.ts", options)).rejects.toMatchObject({ name: "ParserFatalError" })
	})

	it("keeps independent workspaces isolated and a replacement usable", async () => {
		const failedWorker = new MockWorker()
		const otherWorker = new MockWorker()
		const failed = new ParseWorkerClient(() => failedWorker)
		const other = new ParseWorkerClient(() => otherWorker)
		const failure = failed.parseFile("bad.ts", options).catch((error) => error)
		const success = other.parseFile("good.ts", options)
		await drain()
		failedWorker.emit("exit", 1)
		await failure
		otherWorker.emit("message", { id: otherWorker.requests[0].id, blocks: [] })
		await expect(success).resolves.toEqual([])
		expect(otherWorker.terminate).not.toHaveBeenCalled()
		other.stop()
	})
})
