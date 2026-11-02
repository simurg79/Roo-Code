import { CodeIndexOrchestrator } from "../orchestrator"
import { ParserFatalError } from "../parser-errors"
import { INDEX_STOP_LIMIT_MS } from "../constants"

vi.mock("../generation-allocator", () => ({ GenerationAllocator: vi.fn() }))
vi.mock("vscode", () => ({ workspace: { workspaceFolders: [{ uri: { fsPath: "/workspace" } }] } }))
vi.mock("../../../i18n", () => ({ t: (key: string) => key }))

function deferred() {
	let resolve!: () => void
	let reject!: (error: Error) => void
	const promise = new Promise<void>((complete, fail) => {
		resolve = complete
		reject = fail
	})
	return { promise, resolve, reject }
}

async function drain() {
	for (let iter = 0; iter < 30; iter++) await Promise.resolve()
}

describe("CodeIndexOrchestrator lifecycle", () => {
	let state: any
	let cache: any
	let store: any
	let scanner: any
	let watcher: any
	let worker: any
	let gate: any
	let allocator: any
	let current: boolean
	let fatal: ReturnType<typeof vi.fn>
	let orchestrator: CodeIndexOrchestrator

	beforeEach(() => {
		vi.useFakeTimers()
		let status = "Standby"
		state = {
			get state() {
				return status
			},
			setSystemState: vi.fn((next: string) => {
				status = next
			}),
			reportBlockIndexingProgress: vi.fn(),
			reportFileQueueProgress: vi.fn(),
		}
		cache = { getOpenFiles: vi.fn(() => ({})), clearCacheFile: vi.fn(), flush: vi.fn() }
		store = {
			initialize: vi.fn().mockResolvedValue(false),
			markIndexingIncomplete: vi.fn(),
			markIndexingComplete: vi.fn(),
			clearCollection: vi.fn(),
			deleteCollection: vi.fn(),
		}
		scanner = {
			hasIncompleteFiles: false,
			scanDirectory: vi.fn().mockResolvedValue({ stats: { processed: 0, skipped: 0 }, totalBlockCount: 0 }),
		}
		watcher = {
			isProcessing: false,
			initialize: vi.fn(),
			dispose: vi.fn(),
			onDidStartBatchProcessing: vi.fn(() => ({ dispose: vi.fn() })),
			onBatchProgressUpdate: vi.fn(() => ({ dispose: vi.fn() })),
			onDidFinishBatchProcessing: vi.fn(() => ({ dispose: vi.fn() })),
			onParserFatal: vi.fn(() => ({ dispose: vi.fn() })),
		}
		worker = { stop: vi.fn(), stopped: Promise.resolve(), logStopTimeout: vi.fn() }
		gate = {
			run: vi.fn(async (_signal, write) => write()),
			settled: vi.fn().mockResolvedValue(undefined),
			hasPending: vi.fn(() => false),
			abandon: vi.fn(),
			stopAt: vi.fn(),
		}
		allocator = { initialize: vi.fn() }
		current = true
		fatal = vi.fn()
		orchestrator = new CodeIndexOrchestrator(
			{ isFeatureConfigured: true } as any,
			state,
			"/workspace",
			cache,
			store,
			scanner,
			watcher,
			worker,
			fatal,
			vi.fn(),
			gate,
			allocator,
			() => current,
		)
	})

	afterEach(() => vi.useRealTimers())

	it("initializes the allocator after the store and before dispatch", async () => {
		const order: string[] = []
		store.initialize.mockImplementation(async () => {
			order.push("store")
			return false
		})
		allocator.initialize.mockImplementation(async () => {
			order.push("allocator")
		})
		scanner.scanDirectory.mockImplementation(async () => {
			order.push("scan")
			return { stats: { processed: 0, skipped: 0 }, totalBlockCount: 0 }
		})
		await orchestrator.startIndexing()
		expect(order).toEqual(["store", "allocator", "scan"])
		expect(allocator.initialize).toHaveBeenCalledWith(store, expect.any(AbortSignal), gate)
		expect(state.state).toBe("Indexed")
	})

	it("refuses scanning after a durable reservation failure without destroying data", async () => {
		allocator.initialize.mockRejectedValue(new Error("Storage reservation failed"))
		await orchestrator.startIndexing()
		expect(scanner.scanDirectory).not.toHaveBeenCalled()
		expect(state.state).toBe("Error")
		expect(store.clearCollection).not.toHaveBeenCalled()
		expect(cache.clearCacheFile).not.toHaveBeenCalled()
	})

	it.each(["batch error", "incomplete file", "missing blocks"])(
		"does not complete a scan with %s",
		async (reason) => {
			scanner.scanDirectory.mockImplementation(
				async (_directory: string, onError: any, onIndexed: any, onParsed: any) => {
					if (reason === "batch error") onError(new Error("save failed"))
					if (reason === "missing blocks") {
						onParsed(10)
						onIndexed(9)
					}
					return {
						stats: { processed: 1, skipped: 0 },
						totalBlockCount: 10,
						incompleteFiles: reason === "incomplete file" ? ["bad.ts"] : [],
					}
				},
			)
			await orchestrator.startIndexing()
			expect(store.markIndexingComplete).not.toHaveBeenCalled()
			expect(state.state).toBe("Standby")
			expect(state.setSystemState).toHaveBeenLastCalledWith(
				"Standby",
				"embeddings:orchestrator.indexingStoppedPartial",
			)
		},
	)

	it("queue progress never declares a failed watcher batch Indexed", async () => {
		await orchestrator.startIndexing()
		state.setSystemState.mockClear()
		watcher.onDidStartBatchProcessing.mock.calls[0][0](["bad.ts"])
		watcher.onBatchProgressUpdate.mock.calls[0][0]({ processedInBatch: 1, totalInBatch: 1 })
		expect(state.state).toBe("Indexing")
		watcher.onDidFinishBatchProcessing.mock.calls[0][0]({ processedFiles: [{ path: "bad.ts", status: "error" }] })
		expect(state.state).toBe("Standby")
		expect(state.setSystemState.mock.calls.some(([next]: string[]) => next === "Indexed")).toBe(false)
	})

	it("reports partial when cancellation interrupts a watcher before durable invalidation", async () => {
		await orchestrator.startIndexing()
		watcher.isProcessing = true
		watcher.onDidStartBatchProcessing.mock.calls[0][0](["reading.ts"])
		await orchestrator.stopIndexing()
		expect(state.setSystemState).toHaveBeenLastCalledWith(
			"Standby",
			"embeddings:orchestrator.indexingStoppedPartial",
		)
	})

	it("idle cancel preserves state and message, while disable disposes idle resources", async () => {
		await orchestrator.startIndexing()
		state.setSystemState.mockClear()
		await orchestrator.stopIndexing()
		expect(state.setSystemState).not.toHaveBeenCalled()
		expect(watcher.dispose).not.toHaveBeenCalled()
		await orchestrator.stopWatcher()
		expect(watcher.dispose).toHaveBeenCalledOnce()
		expect(state.setSystemState).not.toHaveBeenCalled()
	})

	it.each(["scan", "gate", "worker"])("bounds stopping when %s never settles", async (pending) => {
		const held = deferred()
		if (pending === "scan") scanner.scanDirectory.mockReturnValue(held.promise)
		if (pending === "gate") {
			gate.settled.mockReturnValue(held.promise)
			gate.hasPending.mockReturnValue(true)
		}
		if (pending === "worker") worker.stopped = held.promise
		const scan = orchestrator.startIndexing()
		await drain()
		watcher.isProcessing = true
		const stop = orchestrator.stopIndexing()
		expect(orchestrator.stopIndexing()).toBe(stop)
		expect(orchestrator.stopWatcher()).toBe(stop)
		expect(state.state).toBe("Stopping")
		await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS - 1)
		expect(state.state).toBe("Stopping")
		await vi.advanceTimersByTimeAsync(1)
		await stop
		expect(gate.abandon).toHaveBeenCalledOnce()
		expect(state.setSystemState).toHaveBeenLastCalledWith(
			"Standby",
			"embeddings:orchestrator.indexingStoppedPartial",
		)
		expect(worker.logStopTimeout).toHaveBeenCalledTimes(pending === "worker" ? 1 : 0)
		held.resolve()
		await scan
		expect(store.markIndexingComplete).toHaveBeenCalledTimes(pending === "scan" ? 0 : 1)
	})

	it("waits for all scan, writes and physical worker exit before a fully settled stop", async () => {
		const scanFinished = deferred()
		const writesFinished = deferred()
		const workerFinished = deferred()
		scanner.scanDirectory.mockReturnValue(scanFinished.promise)
		gate.settled.mockReturnValue(writesFinished.promise)
		worker.stopped = workerFinished.promise
		const scan = orchestrator.startIndexing()
		await drain()
		const stop = orchestrator.stopIndexing()
		scanFinished.resolve()
		writesFinished.resolve()
		await drain()
		expect(state.state).toBe("Stopping")
		workerFinished.resolve()
		await stop
		await scan
		expect(state.setSystemState).toHaveBeenLastCalledWith("Standby", "embeddings:orchestrator.indexingStopped")
		expect(gate.abandon).not.toHaveBeenCalled()
	})

	it("preserves incomplete-file status even when every stop wait settles", async () => {
		const scanFinished = deferred()
		scanner.scanDirectory.mockReturnValue(scanFinished.promise)
		scanner.hasIncompleteFiles = true
		void orchestrator.startIndexing()
		await drain()
		const stop = orchestrator.stopIndexing()
		scanFinished.resolve()
		await stop
		expect(state.setSystemState).toHaveBeenLastCalledWith(
			"Standby",
			"embeddings:orchestrator.indexingStoppedPartial",
		)
	})

	it("does not overwrite a newer attempt when the previous stop expires", async () => {
		scanner.scanDirectory.mockReturnValue(deferred().promise)
		void orchestrator.startIndexing()
		await drain()
		const stop = orchestrator.stopIndexing()
		current = false
		state.setSystemState("Indexing", "new attempt")
		await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS)
		await stop
		expect(state.setSystemState).toHaveBeenLastCalledWith("Indexing", "new attempt")
	})

	it.each(["scan", "watcher"])(
		"latches fatal %s failure, preserves Error and rejects late callbacks",
		async (source) => {
			let lateProgress: any
			if (source === "scan") {
				scanner.scanDirectory.mockImplementation(async (_directory: string, _onError: any, onProgress: any) => {
					lateProgress = onProgress
					throw new ParserFatalError("parser-abort", "bad.ts")
				})
			}
			await orchestrator.startIndexing()
			if (source === "watcher") {
				watcher.isProcessing = true
				lateProgress = () =>
					watcher.onBatchProgressUpdate.mock.calls[0][0]({ processedInBatch: 1, totalInBatch: 1 })
				watcher.onParserFatal.mock.calls[0][0](new ParserFatalError("parse-timeout", "bad.ts"))
			}
			await orchestrator.stopIndexing()
			lateProgress(100)
			expect(state.state).toBe("Error")
			expect(state.setSystemState.mock.calls.some(([next]: string[]) => next === "Stopping")).toBe(false)
			expect(fatal).toHaveBeenCalledOnce()
			expect(worker.stop).toHaveBeenCalledOnce()
			expect(store.clearCollection).not.toHaveBeenCalled()
			expect(cache.clearCacheFile).not.toHaveBeenCalled()
			expect(state.reportBlockIndexingProgress).not.toHaveBeenCalled()
			expect(state.reportFileQueueProgress).not.toHaveBeenCalled()
			await orchestrator.startIndexing()
			expect(scanner.scanDirectory).toHaveBeenCalledOnce()
		},
	)

	it("keeps ordinary scan errors and completed data after cancel", async () => {
		scanner.scanDirectory.mockRejectedValue(new Error("network failed"))
		await orchestrator.startIndexing()
		await orchestrator.stopIndexing()
		expect(state.state).toBe("Error")
		expect(store.clearCollection).not.toHaveBeenCalled()
		expect(cache.clearCacheFile).not.toHaveBeenCalled()
	})
})
