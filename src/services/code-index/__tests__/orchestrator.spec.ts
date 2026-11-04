import { CodeIndexOrchestrator } from "../orchestrator"
import { ParserFatalError } from "../parser-errors"
import { INDEX_STOP_LIMIT_MS } from "../constants"
import { FileFailureRegistry } from "../file-failure-registry"

import { CodeIndexStateManager } from "../state-manager"
import { codeIndexLog } from "../code-index-log"

vi.mock("../code-index-log", () => ({ codeIndexLog: { info: vi.fn(), error: vi.fn() } }))

vi.mock("../generation-allocator", () => ({ GenerationAllocator: vi.fn() }))
vi.mock("vscode", () => ({
	workspace: { workspaceFolders: [{ uri: { fsPath: "/workspace" } }] },
	EventEmitter: class {
		event = vi.fn()
		fire = vi.fn()
		dispose = vi.fn()
	},
}))
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
	let failures: FileFailureRegistry

	beforeEach(() => {
		vi.useFakeTimers()
		vi.clearAllMocks()
		state = new CodeIndexStateManager()
		state.setDiagnosticContext({ source: "manager", attempt: 57 })
		vi.spyOn(state, "setSystemState")
		vi.spyOn(state, "reportBlockIndexingProgress")
		vi.spyOn(state, "reportFileQueueProgress")
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
		failures = new FileFailureRegistry()
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
			failures,
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

	it("exposes startup completion before the scan settles", async () => {
		const held = deferred()
		scanner.scanDirectory.mockReturnValue(held.promise)
		const scan = orchestrator.startIndexing()
		await orchestrator.startupResult
		expect(scanner.scanDirectory).toHaveBeenCalledOnce()
		expect(state.state).toBe("Indexing")
		held.resolve()
		await scan
	})

	it.each(["resolve", "reject"])("settles startup promptly on stop before initialization can %s", async (ending) => {
		const held = deferred()
		store.initialize.mockReturnValue(held.promise)
		const scan = orchestrator.startIndexing()
		const startupSettled = vi.fn()
		void orchestrator.startupResult.then(startupSettled, startupSettled)
		await drain()
		expect(startupSettled).not.toHaveBeenCalled()
		const stop = orchestrator.stopIndexing()
		await drain()
		expect(startupSettled).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS)
		await stop
		expect(state.state).toBe("Standby")
		if (ending === "resolve") held.resolve()
		else held.reject(new Error("late initialization failure"))
		await scan
		expect(allocator.initialize).not.toHaveBeenCalled()
		expect(scanner.scanDirectory).not.toHaveBeenCalled()
		expect(startupSettled).toHaveBeenCalledOnce()
		expect(state.state).toBe("Standby")
	})

	it("logs scan, changed-file batch and stop transitions with the original attempt", async () => {
		scanner.scanDirectory.mockImplementation(async (_directory: string, _onError: any, onIndexed: any) => {
			state.setSystemState("Standby", "Paused", "test")
			onIndexed(1)
			return { stats: { processed: 1, skipped: 0 }, totalBlockCount: 1 }
		})
		await orchestrator.startIndexing()
		expect(codeIndexLog.info).toHaveBeenCalledWith(
			"State transition",
			expect.objectContaining({ newState: "Indexed", source: "scan-end", attempt: 57 }),
		)
		watcher.onDidStartBatchProcessing.mock.calls[0][0]()
		state.setSystemState("Standby", "Paused", "test")
		watcher.onBatchProgressUpdate.mock.calls[0][0]({ processedInBatch: 1, totalInBatch: 2 })
		watcher.onDidFinishBatchProcessing.mock.calls[0][0]()
		for (const [newState, source] of [
			["Indexing", "scan"],
			["Indexing", "changed-file-batch"],
			["Indexed", "changed-file-batch"],
		]) {
			expect(codeIndexLog.info).toHaveBeenCalledWith(
				"State transition",
				expect.objectContaining({ newState, source, attempt: 57 }),
			)
		}
		watcher.isProcessing = true
		await orchestrator.stopIndexing()
		for (const newState of ["Stopping", "Standby"]) {
			expect(codeIndexLog.info).toHaveBeenCalledWith(
				"State transition",
				expect.objectContaining({ newState, source: "stop", attempt: 57 }),
			)
		}
	})

	it("returns to Indexed when all failed files recover without a new scan", async () => {
		failures.renew("bad.ts", "revision")
		failures.record("bad.ts", "revision", "read", "read failed", 1, "exhausted")
		await orchestrator.startIndexing()
		expect(state.state).toBe("Standby")
		expect(store.markIndexingComplete).not.toHaveBeenCalled()
		const completion = deferred()
		store.markIndexingComplete.mockReturnValue(completion.promise)
		failures.clear("bad.ts", "revision")
		await drain()
		expect(store.markIndexingComplete).toHaveBeenCalledOnce()
		expect(state.state).toBe("Standby")
		completion.resolve()
		await drain()
		expect(state.state).toBe("Indexed")
		expect(scanner.scanDirectory).toHaveBeenCalledOnce()
	})

	it.each(["stop", "parser", "superseded", "batch"])(
		"does not issue recovery completion after queued work becomes %s",
		async (ending) => {
			failures.renew("bad.ts", "revision")
			failures.record("bad.ts", "revision", "read", "read failed", 1, "exhausted")
			await orchestrator.startIndexing()
			const queued = deferred()
			gate.run.mockImplementation(async (_signal: AbortSignal, write: () => Promise<void>) => {
				await queued.promise
				return write()
			})
			failures.clear("bad.ts", "revision")
			if (ending === "stop") await orchestrator.stopWatcher()
			if (ending === "parser")
				watcher.onParserFatal.mock.calls[0][0](new ParserFatalError("parser-abort", "bad.ts"))
			if (ending === "superseded") current = false
			if (ending === "batch") watcher.onDidStartBatchProcessing.mock.calls[0][0]()
			queued.resolve()
			await drain()
			expect(store.markIndexingComplete).not.toHaveBeenCalled()
			if (ending === "batch") {
				watcher.onDidFinishBatchProcessing.mock.calls[0][0]()
				await drain()
				expect(store.markIndexingComplete).toHaveBeenCalledOnce()
				expect(state.state).toBe("Indexed")
			}
		},
	)

	it.each(["stop", "superseded", "failure"])("handles pending recovery completion on %s", async (ending) => {
		failures.renew("bad.ts", "revision")
		failures.record("bad.ts", "revision", "read", "read failed", 1, "exhausted")
		await orchestrator.startIndexing()
		const completion = deferred()
		store.markIndexingComplete.mockReturnValue(completion.promise)
		failures.clear("bad.ts", "revision")
		await drain()
		if (ending === "stop") await orchestrator.stopWatcher()
		if (ending === "superseded") current = false
		state.setSystemState.mockClear()
		if (ending === "failure") completion.reject(new Error("metadata failed"))
		else completion.resolve()
		await drain()
		if (ending === "failure") {
			expect(state.state).toBe("Error")
			expect(codeIndexLog.error).toHaveBeenCalledWith("Recovery completion failed", { error: expect.any(Error) })
		} else expect(state.setSystemState).not.toHaveBeenCalled()
	})

	it.each(["stop", "parser", "superseded"])("recovery never overrides %s", async (ending) => {
		failures.renew("bad.ts", "revision")
		failures.record("bad.ts", "revision", "read", "read failed", 1, "exhausted")
		await orchestrator.startIndexing()
		if (ending === "stop") await orchestrator.stopWatcher()
		if (ending === "parser") watcher.onParserFatal.mock.calls[0][0](new ParserFatalError("parser-abort", "bad.ts"))
		if (ending === "superseded") current = false
		state.setSystemState.mockClear()
		failures.clear("bad.ts", "revision")
		expect(state.setSystemState).not.toHaveBeenCalled()
	})

	it("distinguishes active retries, exhausted failures and a user stop", async () => {
		await orchestrator.startIndexing()
		failures.renew("bad.ts", "revision")
		failures.record("bad.ts", "revision", "embed", "failed", 1, "retrying")
		expect(state.getCurrentStatus()).toMatchObject({
			systemStatus: "Indexing",
			message: "embeddings:orchestrator.indexingFilesRetrying",
		})
		failures.record("bad.ts", "revision", "embed", "failed", 3, "exhausted")
		expect(state.getCurrentStatus()).toMatchObject({
			systemStatus: "Standby",
			message: "embeddings:orchestrator.indexingFilesFailed",
		})
		watcher.isProcessing = true
		watcher.onDidStartBatchProcessing.mock.calls[0][0]()
		await orchestrator.stopIndexing()
		expect(state.getCurrentStatus()).toMatchObject({
			systemStatus: "Standby",
			message: "embeddings:orchestrator.indexingStoppedPartial",
		})
	})

	it("keeps recovery Indexing while a watcher batch remains active", async () => {
		await orchestrator.startIndexing()
		watcher.onDidStartBatchProcessing.mock.calls[0][0](["bad.ts"])
		failures.renew("bad.ts", "revision")
		failures.record("bad.ts", "revision", "embed", "retrying", 1, "retrying")
		failures.clear("bad.ts", "revision")
		expect(state.state).toBe("Indexing")
		watcher.onDidFinishBatchProcessing.mock.calls[0][0]({ processedFiles: [] })
		expect(state.state).toBe("Indexed")
	})

	it("refuses scanning after a durable reservation failure without destroying data", async () => {
		allocator.initialize.mockRejectedValue(new Error("Storage reservation failed"))
		const scan = orchestrator.startIndexing()
		await expect(orchestrator.startupResult).rejects.toThrow("Storage reservation failed")
		await scan
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
					failures.renew("bad.ts", "revision")
					failures.record("bad.ts", "revision", "verify", "save failed", 3, "exhausted")
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
				"embeddings:orchestrator.indexingFilesFailed",
				"scan-end",
			)
		},
	)

	it("queue progress never declares a failed watcher batch Indexed", async () => {
		await orchestrator.startIndexing()
		state.setSystemState.mockClear()
		watcher.onDidStartBatchProcessing.mock.calls[0][0](["bad.ts"])
		watcher.onBatchProgressUpdate.mock.calls[0][0]({ processedInBatch: 1, totalInBatch: 1 })
		expect(state.state).toBe("Indexing")
		failures.renew("bad.ts", "revision")
		failures.record("bad.ts", "revision", "read", "read failed", 1, "exhausted")
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
			"stop",
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
			"stop",
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
		expect(state.setSystemState).toHaveBeenLastCalledWith(
			"Standby",
			"embeddings:orchestrator.indexingStopped",
			"stop",
		)
		expect(gate.abandon).not.toHaveBeenCalled()
	})

	it("preserves incomplete-file status even when every stop wait settles", async () => {
		const scanFinished = deferred()
		scanner.scanDirectory.mockReturnValue(scanFinished.promise)
		cache.getOpenFiles.mockReturnValue({ "bad.ts": true })
		void orchestrator.startIndexing()
		await drain()
		const stop = orchestrator.stopIndexing()
		scanFinished.resolve()
		await stop
		expect(state.setSystemState).toHaveBeenLastCalledWith(
			"Standby",
			"embeddings:orchestrator.indexingStoppedPartial",
			"stop",
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
			expect(codeIndexLog.info).toHaveBeenCalledWith(
				"State transition",
				expect.objectContaining({ newState: "Error", source: "error", attempt: 57 }),
			)
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
		expect(codeIndexLog.info).toHaveBeenCalledWith(
			"State transition",
			expect.objectContaining({ newState: "Error", source: "error", attempt: 57 }),
		)
		expect(store.clearCollection).not.toHaveBeenCalled()
		expect(cache.clearCacheFile).not.toHaveBeenCalled()
	})
})
