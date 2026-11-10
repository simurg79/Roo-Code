import { CodeIndexManager } from "../manager"
import { CodeIndexServiceFactory } from "../service-factory"
import { CacheManager } from "../cache-manager"
import { LATE_WRITE_GRACE_MS } from "../index-write-gate"
import type { MockedClass } from "vitest"
import { FileIndexWriter } from "../file-completion"
import * as path from "path"

import { codeIndexLog } from "../code-index-log"

vi.mock("../code-index-log", () => ({
	codeIndexLog: {
		configure: vi.fn(),
		redact: (value: string) => value.replaceAll("configured-secret", "[REDACTED]"),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}))

// Helper: create a mock vscode.Uri from an fsPath
function mockUri(fsPath: string, scheme = "file") {
	return {
		fsPath,
		scheme,
		authority: "",
		path: fsPath,
		toString: (skipEncoding?: boolean) => `${scheme}://${fsPath}`,
	}
}

// Mock vscode module
vi.mock("vscode", () => {
	const testPath = require("path")
	const testWorkspacePath = testPath.join(testPath.sep, "test", "workspace")
	return {
		EventEmitter: class {
			private listeners = new Set<(value: unknown) => void>()
			event = (listener: (value: unknown) => void) => {
				this.listeners.add(listener)
				return { dispose: () => this.listeners.delete(listener) }
			}
			fire(value: unknown) {
				this.listeners.forEach((listener) => listener(value))
			}
			dispose() {
				this.listeners.clear()
			}
		},
		Uri: {
			file: (p: string) => ({
				fsPath: p,
				scheme: "file",
				authority: "",
				path: p,
				toString: (_skipEncoding?: boolean) => `file://${p}`,
			}),
			joinPath: vi.fn((...args: any[]) => ({ fsPath: args.join("/") })),
		},
		window: {
			activeTextEditor: null,
		},
		workspace: {
			workspaceFolders: [
				{
					uri: {
						fsPath: testWorkspacePath,
						scheme: "file",
						authority: "",
						path: testWorkspacePath,
						toString: (_skipEncoding?: boolean) => `file://${testWorkspacePath}`,
					},
					name: "test",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn().mockReturnValue({
				onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				dispose: vi.fn(),
			}),
			getWorkspaceFolder: vi.fn(),
		},
		RelativePattern: vi.fn().mockImplementation((base: any, pattern: any) => ({ base, pattern })),
	}
})

// Mock only the essential dependencies
vi.mock("../../../utils/path", () => {
	const testPath = require("path")
	const testWorkspacePath = testPath.join(testPath.sep, "test", "workspace")
	return {
		getWorkspacePath: vi.fn(() => testWorkspacePath),
	}
})

// Mock fs/promises for RooIgnoreController
vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn().mockRejectedValue(new Error("File not found")),
	},
}))

// Mock file utils for RooIgnoreController
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(false),
}))

// Mock ignore module
vi.mock("ignore", () => ({
	default: vi.fn().mockReturnValue({
		add: vi.fn(),
		ignores: vi.fn().mockReturnValue(false),
	}),
}))

vi.mock("../state-manager", () => ({
	CodeIndexStateManager: vi.fn().mockImplementation(() => ({
		onProgressUpdate: vi.fn(),
		getCurrentStatus: vi.fn(),
		dispose: vi.fn(),
		setSystemState: vi.fn(),
		setDiagnosticContext: vi.fn(),
	})),
}))

vi.mock("../generation-allocator", () => ({ GenerationAllocator: vi.fn() }))
vi.mock("../orchestrator", () => ({
	CodeIndexOrchestrator: vi.fn().mockImplementation((...dependencies: any[]) => ({
		startIndexing: vi.fn().mockResolvedValue(undefined),
		stopIndexing: vi.fn().mockResolvedValue(undefined),
		stopWatcher: vi.fn().mockResolvedValue(undefined),
		generationAllocator: dependencies[11],
		isCurrentAttempt: dependencies[12],
		onFatal: dependencies[8],
		onStopped: dependencies[9],
	})),
}))
vi.mock("../service-factory")
const MockedCodeIndexServiceFactory = CodeIndexServiceFactory as MockedClass<typeof CodeIndexServiceFactory>

describe("CodeIndexManager - handleSettingsChange regression", () => {
	let mockContext: any
	let manager: CodeIndexManager

	// Define test paths for use in tests
	const testWorkspacePath = path.join(path.sep, "test", "workspace")
	const testExtensionPath = path.join(path.sep, "test", "extension")
	const testStoragePath = path.join(path.sep, "test", "storage")
	const testGlobalStoragePath = path.join(path.sep, "test", "global-storage")
	const testLogPath = path.join(path.sep, "test", "log")

	beforeEach(() => {
		// Clear all instances before each test
		CodeIndexManager.disposeAll()

		const workspaceStateStore: Record<string, any> = {}
		const globalStateStore: Record<string, any> = {}
		mockContext = {
			subscriptions: [],
			workspaceState: {
				get: vi.fn((key: string, defaultValue?: any) => workspaceStateStore[key] ?? defaultValue),
				update: vi.fn(async (key: string, value: any) => {
					workspaceStateStore[key] = value
				}),
			} as any,
			globalState: {
				get: vi.fn((key: string, defaultValue?: any) => globalStateStore[key] ?? defaultValue),
				update: vi.fn(async (key: string, value: any) => {
					globalStateStore[key] = value
				}),
			} as any,
			extensionUri: {} as any,
			extensionPath: testExtensionPath,
			asAbsolutePath: vi.fn(),
			storageUri: {} as any,
			storagePath: testStoragePath,
			globalStorageUri: {} as any,
			globalStoragePath: testGlobalStoragePath,
			logUri: {} as any,
			logPath: testLogPath,
			extensionMode: 3, // vscode.ExtensionMode.Test
			secrets: {} as any,
			environmentVariableCollection: {} as any,
			extension: {} as any,
			languageModelAccessInformation: {} as any,
		}

		manager = CodeIndexManager.getInstance(mockContext)!
	})

	afterEach(() => {
		CodeIndexManager.disposeAll()
	})

	it.each(["initialize", "settings"])("T12 recovers grace from cache load time through %s", async (entry) => {
		vi.useFakeTimers()
		vi.setSystemTime(100_000)
		const internal = manager as any
		internal._configManager = {
			loadConfiguration: vi.fn().mockResolvedValue({ requiresRestart: true }),
			isFeatureEnabled: true,
			isFeatureConfigured: true,
		}
		const initialize = vi.spyOn(CacheManager.prototype, "initialize").mockImplementation(async function (
			this: CacheManager,
		) {
			this.loadedAt = Date.now()
			vi.setSystemTime(105_000)
		})
		const openFiles = vi.spyOn(CacheManager.prototype, "getOpenFiles").mockReturnValue({ "open.ts": true })
		const recreate = vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
			internal._orchestrator = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
		})
		try {
			if (entry === "initialize") await manager.initialize({} as any)
			else await manager.handleSettingsChange()
			expect(internal.writeGate.graceDeadline("open.ts")).toBe(100_000 + LATE_WRITE_GRACE_MS)
			expect(recreate).toHaveBeenCalledOnce()
		} finally {
			initialize.mockRestore()
			openFiles.mockRestore()
			recreate.mockRestore()
			vi.useRealTimers()
		}
	})

	describe("startup and failure status", () => {
		function prepare() {
			const internal = manager as any
			internal._configManager = { isFeatureEnabled: true, isFeatureConfigured: true }
			internal._cacheManager = {}
			internal._searchService = {}
			internal._stateManager.getCurrentStatus.mockReturnValue({ systemStatus: "Standby", message: "partial" })
			return internal
		}

		it.each([true, false])(
			"retries failed startup on settings save (configuration changed: %s)",
			async (requiresRestart) => {
				const internal = prepare()
				internal._configManager.loadConfiguration = vi.fn().mockResolvedValue({ requiresRestart })
				const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
				const recreate = vi
					.spyOn(internal, "_recreateServices")
					.mockRejectedValueOnce(new Error("Invalid key or URL"))
					.mockImplementation(async () => {
						internal._orchestrator = replacement
						internal._stateManager.getCurrentStatus.mockReturnValue({
							systemStatus: "Indexing",
							message: "started",
						})
					})
				await expect(manager.startIndexing()).rejects.toThrow("Invalid key or URL")
				expect(manager.state).toBe("Error")
				await manager.handleSettingsChange()
				expect(recreate).toHaveBeenCalledTimes(2)
				expect(replacement.startIndexing).toHaveBeenCalledOnce()
				expect(manager.state).toBe("Indexing")
				expect(internal.startupFailureMessage).toBeUndefined()
			},
		)

		it("returns the active scan's startup result without rebuilding or stopping it", async () => {
			const internal = prepare()
			internal._stateManager.getCurrentStatus.mockReturnValue({ systemStatus: "Indexing" })
			const startupResult = Promise.resolve()
			const active = {
				isActive: true,
				isScanning: true,
				startupResult,
				startIndexing: vi.fn(),
				stopWatcher: vi.fn(),
			}
			internal._orchestrator = active
			const recreate = vi.spyOn(internal, "_recreateServices")
			expect(manager.startIndexing()).toBe(startupResult)
			expect(manager.startIndexing()).toBe(startupResult)
			await startupResult
			expect(recreate).not.toHaveBeenCalled()
			expect(active.stopWatcher).not.toHaveBeenCalled()
			expect(active.startIndexing).not.toHaveBeenCalled()
			expect(internal._orchestrator).toBe(active)
		})

		it("reports a background scan failure with exactly one Error transition and diagnostic entry", async () => {
			const internal = prepare()
			const { CodeIndexOrchestrator } = await vi.importActual<typeof import("../orchestrator")>("../orchestrator")
			const { CodeIndexStateManager } =
				await vi.importActual<typeof import("../state-manager")>("../state-manager")
			const state = new CodeIndexStateManager()
			internal._stateManager = state
			const transitions = vi.spyOn(state, "setSystemState")
			let rejectScan!: (error: Error) => void
			const scan = new Promise<never>((_resolve, reject) => {
				rejectScan = reject
			})
			const replacement = new CodeIndexOrchestrator(
				internal._configManager,
				state,
				testWorkspacePath,
				{ getOpenFiles: () => ({}) } as any,
				{ initialize: vi.fn().mockResolvedValue(false), markIndexingIncomplete: vi.fn() } as any,
				{ scanDirectory: vi.fn(() => scan) } as any,
				{ dispose: vi.fn() } as any,
				undefined,
				undefined,
				undefined,
				undefined,
				{ initialize: vi.fn() } as any,
			)
			const recreate = vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				internal._orchestrator = replacement
			})
			await manager.startIndexing()
			expect(replacement.isScanning).toBe(true)
			expect(manager.startIndexing()).toBe(replacement.startupResult)
			expect(recreate).toHaveBeenCalledOnce()
			expect(replacement.stopped).toBe(false)
			vi.mocked(codeIndexLog.info).mockClear()
			vi.mocked(codeIndexLog.error).mockClear()
			rejectScan(new Error("Scan failed"))
			await replacement.startIndexing()
			expect(transitions.mock.calls.filter(([next]) => next === "Error")).toHaveLength(1)
			expect(
				vi
					.mocked(codeIndexLog.info)
					.mock.calls.filter(
						([message, fields]) => message === "State transition" && (fields as any).newState === "Error",
					),
			).toHaveLength(1)
			expect(codeIndexLog.error).toHaveBeenCalledTimes(1)
			expect(codeIndexLog.error).toHaveBeenCalledWith("Initial scan failed", expect.any(Object))
		})

		it.each([
			["retrying", false, "Indexing", "indexingFilesRetrying"],
			["exhausted", false, "Standby", "indexingFilesFailed"],
			["retrying", true, "Standby", "indexingStoppedPartial"],
		] as const)("shows %s failures with stopped=%s distinctly", (failureState, stopped, systemStatus, message) => {
			const internal = prepare()
			internal.servicesStopped = stopped
			manager.fileFailureRegistry.renew("bad.ts", "revision")
			manager.fileFailureRegistry.record("bad.ts", "revision", "embed", "failed", 1, failureState)
			expect(manager.getCurrentStatus()).toMatchObject({
				systemStatus,
				message: expect.stringContaining(message),
			})
		})

		it("shares startup while rebuilding and resolves before a delayed scan", async () => {
			const internal = prepare()
			let release!: () => void
			const held = new Promise<void>((resolve) => {
				release = resolve
			})
			const replacement = { startIndexing: vi.fn(() => new Promise(() => {})), stopWatcher: vi.fn() }
			const recreate = vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				await held
				internal._orchestrator = replacement
			})
			const first = manager.startIndexing()
			const second = manager.startIndexing()
			expect(first).toBe(second)
			await Promise.resolve()
			expect(recreate).toHaveBeenCalledOnce()
			expect(replacement.startIndexing).not.toHaveBeenCalled()
			release()
			await first
			expect(replacement.startIndexing).toHaveBeenCalledOnce()
		})

		it.each(["rebuild", "startup"])("reports and rejects %s failure", async (phase) => {
			const internal = prepare()
			vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				if (phase === "rebuild") throw new Error("configured-secret failed")
				internal._orchestrator = {
					startIndexing: vi.fn(() => Promise.resolve()),
					get startupResult() {
						return Promise.reject(new Error("configured-secret failed"))
					},
					stopWatcher: vi.fn(),
				}
			})
			await expect(manager.startIndexing()).rejects.toThrow("configured-secret failed")
			expect(manager.getCurrentStatus()).toMatchObject({ systemStatus: "Error", message: "[REDACTED] failed" })
			expect(codeIndexLog.error).toHaveBeenCalledWith("Indexing startup failed", expect.any(Object))
		})

		it.each(["stop", "disable", "feature-disable"])(
			"does not report a startup error after %s supersedes a rejected rebuild",
			async (ending) => {
				const internal = prepare()
				let rejectRebuild!: (error: Error) => void
				const held = new Promise<void>((_resolve, reject) => {
					rejectRebuild = reject
				})
				vi.spyOn(internal, "_recreateServices").mockReturnValue(held)
				const startup = manager.startIndexing()
				await Promise.resolve()
				if (ending === "stop") await manager.stopIndexing()
				if (ending === "disable") await manager.setWorkspaceEnabled(false)
				if (ending === "feature-disable") {
					internal._configManager.isFeatureEnabled = false
					internal._configManager.loadConfiguration = vi.fn().mockResolvedValue({ requiresRestart: false })
					await manager.handleSettingsChange()
				}
				internal._stateManager.setSystemState.mockClear()
				vi.mocked(codeIndexLog.error).mockClear()
				rejectRebuild(new Error("late rebuild failure"))
				await expect(startup).resolves.toBeUndefined()
				expect(internal._stateManager.setSystemState).not.toHaveBeenCalled()
				expect(manager.getCurrentStatus().systemStatus).not.toBe("Error")
				expect(codeIndexLog.error).not.toHaveBeenCalled()
			},
		)

		it.each(["stopIndexing", "stopWatcher"] as const)(
			"does not start a replacement after %s during rebuild",
			async (stop) => {
				const internal = prepare()
				let release!: () => void
				const held = new Promise<void>((resolve) => {
					release = resolve
				})
				const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
				vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
					await held
					internal._orchestrator = replacement
				})
				const startup = manager.startIndexing()
				await Promise.resolve()
				await manager[stop]()
				release()
				await startup
				expect(replacement.startIndexing).not.toHaveBeenCalled()
			},
		)

		it("retains details and budgets across automatic recreation, renewing only on explicit start", async () => {
			const internal = prepare()
			const registry = manager.fileFailureRegistry
			registry.renew("bad.ts", "revision")
			registry.record("bad.ts", "revision", "embed", "configured-secret failed", 3, "exhausted")
			const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
			vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				internal._orchestrator = replacement
			})
			internal._configManager.loadConfiguration = vi.fn().mockResolvedValue({ requiresRestart: true })
			await manager.handleSettingsChange()
			expect(registry.isExhausted("bad.ts", "revision", "embed")).toBe(true)
			await manager.startIndexing()
			expect(manager.fileFailureRegistry).toBe(registry)
			expect(registry.isExhausted("bad.ts", "revision", "embed")).toBe(false)
			expect(manager.getCurrentStatus().failedFileSummary).toEqual({
				count: 1,
				path: "bad.ts",
				activity: "embed",
				reason: "[REDACTED] failed",
				state: "exhausted",
			})
		})

		it("redacts primary failure messages as well as file details", () => {
			const internal = prepare()
			internal._stateManager.getCurrentStatus.mockReturnValue({
				systemStatus: "Error",
				message: "Search failed: configured-secret",
			})
			expect(manager.getCurrentStatus().message).toBe("Search failed: [REDACTED]")
			internal.parserFailed = true
			internal.parserFailureMessage = "Parser failed: configured-secret"
			expect(manager.getCurrentStatus().message).toBe("Parser failed: [REDACTED]")
		})

		it("emits all sanitized failures alongside primary status with parser and stop precedence", async () => {
			const internal = prepare()
			const update = vi.fn()
			manager.onProgressUpdate(update)
			const registry = manager.fileFailureRegistry
			registry.renew("bad.ts", "revision")
			registry.record("bad.ts", "revision", "verify", "configured-secret failed", 1, "retrying")
			expect(update).toHaveBeenLastCalledWith(
				expect.objectContaining({
					systemStatus: "Indexing",
					failedFiles: [expect.objectContaining({ reason: "[REDACTED] failed" })],
				}),
			)
			internal._stateManager.getCurrentStatus.mockReturnValue({ systemStatus: "Stopping", message: "stopping" })
			expect(manager.getCurrentStatus()).toMatchObject({ systemStatus: "Stopping", message: "stopping" })
			internal.parserFailed = true
			internal.parserFailureMessage = "parser failed"
			expect(manager.getCurrentStatus()).toMatchObject({ systemStatus: "Error", message: "parser failed" })
			internal.parserFailed = false
			await manager.setWorkspaceEnabled(false)
			expect(manager.getCurrentStatus().failedFiles[0].state).toBe("exhausted")
		})

		it("rebuilds and resets budgets for an idle service set with a retrying registry entry", async () => {
			const internal = prepare()
			const idle = {
				isActive: false,
				startupResult: Promise.resolve(),
				startIndexing: vi.fn(),
				stopWatcher: vi.fn(),
			}
			internal._orchestrator = idle
			const registry = manager.fileFailureRegistry
			registry.renew("bad.ts", "revision")
			registry.record("bad.ts", "revision", "embed", "failed", 1, "retrying")
			expect(manager.state).toBe("Indexing")
			const resetAllBudgets = vi.spyOn(registry, "resetAllBudgets")
			const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
			const recreate = vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				internal._orchestrator = replacement
			})
			await manager.startIndexing()
			expect(recreate).toHaveBeenCalledOnce()
			expect(resetAllBudgets).toHaveBeenCalledOnce()
			expect(replacement.startIndexing).toHaveBeenCalledOnce()
		})

		// A settings save during Start must not surface Error or start two scans (spec 24-25).
		it("coordinates a settings save with an in-flight Start", async () => {
			const internal = prepare()
			internal._configManager.loadConfiguration = vi.fn().mockResolvedValue({ requiresRestart: true })
			let release!: () => void
			const held = new Promise<void>((resolve) => {
				release = resolve
			})
			const scans: Array<ReturnType<typeof vi.fn>> = []
			let rebuildCount = 0
			vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				const rebuild = ++rebuildCount
				internal._orchestrator = undefined
				await held
				if (rebuild !== rebuildCount) return
				const startIndexing = vi.fn()
				scans.push(startIndexing)
				internal._orchestrator = { startIndexing, stopWatcher: vi.fn() }
			})
			const startup = manager.startIndexing()
			startup.catch(() => {})
			await Promise.resolve()
			await Promise.resolve()
			const settings = manager.handleSettingsChange()
			release()
			const [startOutcome] = await Promise.allSettled([startup, settings])
			expect(startOutcome.status).toBe("fulfilled")
			expect(internal._stateManager.setSystemState).not.toHaveBeenCalledWith("Error", expect.anything())
			expect(scans.flatMap((scan) => scan.mock.calls)).toHaveLength(1)
		})

		// A changed-file retry wait keeps isActive true (Decision 6).
		it("rebuilds and resets budgets when Start arrives during a retry wait inside a changed-file batch", async () => {
			const internal = prepare()
			const { CodeIndexOrchestrator } = await vi.importActual<typeof import("../orchestrator")>("../orchestrator")
			const batching = new CodeIndexOrchestrator(
				internal._configManager,
				internal._stateManager,
				testWorkspacePath,
				{ getOpenFiles: () => ({}) } as any,
				{} as any,
				{} as any,
				{ dispose: vi.fn() } as any,
			) as any
			// Same field the watcher's onDidStartBatchProcessing sets (orchestrator.ts startWatcher).
			batching.watcherBatchPending = true
			expect(batching.isActive).toBe(true)
			internal._orchestrator = batching
			const registry = manager.fileFailureRegistry
			registry.renew("bad.ts", "revision")
			registry.record("bad.ts", "revision", "embed", "failed", 1, "retrying")
			const resetAllBudgets = vi.spyOn(registry, "resetAllBudgets")
			const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
			const recreate = vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				internal._orchestrator = replacement
			})
			await manager.startIndexing()
			expect(recreate).toHaveBeenCalledOnce()
			expect(resetAllBudgets).toHaveBeenCalledOnce()
			expect(replacement.startIndexing).toHaveBeenCalledOnce()
		})

		it("interrupts real retry backoff after a watcher batch starts and explicitly retries once", async () => {
			vi.useFakeTimers()
			try {
				const internal = prepare()
				const { CodeIndexOrchestrator } =
					await vi.importActual<typeof import("../orchestrator")>("../orchestrator")
				let watcherSignal!: AbortSignal
				const watcher = {
					initialize: vi.fn(async (signal: AbortSignal) => {
						watcherSignal = signal
					}),
					dispose: vi.fn(),
					onDidStartBatchProcessing: vi.fn(() => ({ dispose: vi.fn() })),
					onBatchProgressUpdate: vi.fn(() => ({ dispose: vi.fn() })),
					onDidFinishBatchProcessing: vi.fn(() => ({ dispose: vi.fn() })),
				}
				const batching = new CodeIndexOrchestrator(
					internal._configManager,
					internal._stateManager,
					testWorkspacePath,
					{ getOpenFiles: () => ({}) } as any,
					{
						initialize: vi.fn().mockResolvedValue(false),
						markIndexingIncomplete: vi.fn(),
						markIndexingComplete: vi.fn(),
					} as any,
					{ scanDirectory: vi.fn().mockResolvedValue({ incompleteFiles: false }) } as any,
					watcher as any,
					undefined,
					undefined,
					undefined,
					internal.writeGate,
					{ initialize: vi.fn() } as any,
					undefined,
					manager.fileFailureRegistry,
				)
				await batching.startIndexing()
				internal._orchestrator = batching
				const startBatch = watcher.onDidStartBatchProcessing.mock.calls[0] as unknown as [() => void]
				startBatch[0]()
				expect(batching.isActive).toBe(true)
				expect(batching.isScanning).toBe(false)
				const registry = manager.fileFailureRegistry
				registry.renew("bad.ts", "revision")
				const writer = new FileIndexWriter(
					{} as any,
					{} as any,
					internal.writeGate,
					{} as any,
					testWorkspacePath,
					registry,
				)
				const operation = vi.fn().mockRejectedValue(Object.assign(new Error("unavailable"), { status: 503 }))
				const retry = writer
					.retryTransient(operation, {
						signal: watcherSignal,
						activity: "embed",
						file: path.join(testWorkspacePath, "bad.ts"),
						revision: "revision",
					})
					.catch((error: Error) => error)
				await vi.advanceTimersByTimeAsync(0)
				expect(registry.get("bad.ts")).toMatchObject({ state: "retrying", attempt: 1 })
				const resetAllBudgets = vi.spyOn(registry, "resetAllBudgets")
				const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
				const recreate = vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
					void batching.stopWatcher()
					internal._orchestrator = replacement
				})
				const startup = manager.startIndexing()
				expect(manager.startIndexing()).toBe(startup)
				await startup
				expect(await retry).toMatchObject({ name: "AbortError" })
				await vi.advanceTimersByTimeAsync(2_000)
				expect(operation).toHaveBeenCalledOnce()
				expect(watcherSignal.aborted).toBe(true)
				expect(watcher.dispose).toHaveBeenCalledOnce()
				expect(recreate).toHaveBeenCalledOnce()
				expect(resetAllBudgets).toHaveBeenCalledOnce()
				expect(registry.getFailure("bad.ts", "revision", "embed")).toBeUndefined()
				expect(replacement.startIndexing).toHaveBeenCalledOnce()
			} finally {
				vi.useRealTimers()
			}
		})

		it.each(["stop", "parser-failure"])("does not drain pending settings after %s", async (ending) => {
			const internal = prepare()
			internal._configManager.loadConfiguration = vi.fn().mockResolvedValue({ requiresRestart: true })
			let release!: () => void
			const held = new Promise<void>((resolve) => {
				release = resolve
			})
			const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
			const recreate = vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				await held
				internal._orchestrator = replacement
			})
			const startup = manager.startIndexing()
			await Promise.resolve()
			const settings = manager.handleSettingsChange()
			await Promise.resolve()
			await Promise.resolve()
			if (ending === "stop") await manager.stopIndexing()
			else {
				internal.parserFailed = true
				internal.parserFailureMessage = "parser failed"
			}
			release()
			await Promise.all([startup, settings])
			expect(recreate).toHaveBeenCalledOnce()
			expect(replacement.startIndexing).not.toHaveBeenCalled()
			if (ending === "parser-failure") {
				expect(manager.state).toBe("Error")
				expect(internal.parserFailed).toBe(true)
			}
		})

		it("applies a requiresRestart settings save that arrives during an in-flight Start", async () => {
			const internal = prepare()
			const order: string[] = []
			let configuredModel = "previous-model"
			const rebuiltModels: string[] = []
			internal._configManager.loadConfiguration = vi.fn(async () => {
				configuredModel = "saved-model"
				order.push("settings-loaded")
				return { requiresRestart: true }
			})
			let release!: () => void
			const held = new Promise<void>((resolve) => {
				release = resolve
			})
			const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
			vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				order.push("rebuild-start")
				rebuiltModels.push(configuredModel)
				await held
				internal._orchestrator = replacement
			})
			const startup = manager.startIndexing()
			await Promise.resolve()
			await Promise.resolve()
			const settings = manager.handleSettingsChange()
			await Promise.resolve()
			await Promise.resolve()
			release()
			await Promise.allSettled([startup, settings])
			await Promise.resolve()
			await internal.startInFlight
			const lastLoad = order.lastIndexOf("settings-loaded")
			expect(lastLoad).toBeGreaterThanOrEqual(0)
			expect(order.slice(lastLoad + 1)).toContain("rebuild-start")
			expect(rebuiltModels).toEqual(["previous-model", "saved-model"])
			expect(replacement.startIndexing).toHaveBeenCalledOnce()
		})
		it("shares startup through the settings rebuild and scans only the final service set", async () => {
			const internal = prepare()
			internal._configManager.loadConfiguration = vi.fn().mockResolvedValue({ requiresRestart: true })
			let releaseStart!: () => void
			const startHeld = new Promise<void>((resolve) => {
				releaseStart = resolve
			})
			let releaseSettings!: () => void
			const settingsHeld = new Promise<void>((resolve) => {
				releaseSettings = resolve
			})
			const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
			const recreate = vi
				.spyOn(internal, "_recreateServices")
				.mockImplementationOnce(async () => {
					internal._orchestrator = replacement
					await startHeld
				})
				.mockImplementation(async () => {
					internal._orchestrator = undefined
					await settingsHeld
					internal._orchestrator = replacement
				})
			const startup = manager.startIndexing()
			await Promise.resolve()
			const settings = manager.handleSettingsChange()
			await Promise.resolve()
			await Promise.resolve()
			releaseStart()
			await vi.waitFor(() => expect(recreate).toHaveBeenCalledTimes(2))
			expect(manager.startIndexing()).toBe(startup)
			expect(replacement.startIndexing).not.toHaveBeenCalled()
			releaseSettings()
			await expect(startup).resolves.toBeUndefined()
			await settings
			expect(replacement.startIndexing).toHaveBeenCalledOnce()
			expect(internal.startupFailureMessage).toBeUndefined()
			expect(internal._stateManager.setSystemState).not.toHaveBeenCalledWith("Error", expect.anything())
		})

		it("shares a settings rebuild with Start arriving before that rebuild finishes", async () => {
			const internal = prepare()
			internal._configManager.loadConfiguration = vi.fn().mockResolvedValue({ requiresRestart: true })
			let release!: () => void
			const held = new Promise<void>((resolve) => {
				release = resolve
			})
			const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
			const recreate = vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				await held
				internal._orchestrator = replacement
			})
			const settings = manager.handleSettingsChange()
			await Promise.resolve()
			await Promise.resolve()
			const sharedStartup = internal.startInFlight
			expect(sharedStartup).toBeDefined()
			expect(manager.startIndexing()).toBe(sharedStartup)
			release()
			await settings
			expect(recreate).toHaveBeenCalledOnce()
			expect(replacement.startIndexing).toHaveBeenCalledOnce()
			expect(internal.startupFailureMessage).toBeUndefined()
		})

		it.each(["cache", "rebuild", "startup"])(
			"records a settings %s failure in status and diagnostics",
			async (phase) => {
				const internal = prepare()
				internal._configManager.loadConfiguration = vi.fn().mockResolvedValue({ requiresRestart: true })
				const failure = new Error("configured-secret settings failure")
				const cacheInitialize = vi.spyOn(CacheManager.prototype, "initialize")
				if (phase === "cache") {
					internal._cacheManager = undefined
					cacheInitialize.mockRejectedValueOnce(failure)
				}
				vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
					if (phase === "rebuild") throw failure
					internal._orchestrator = {
						startIndexing: vi.fn(),
						get startupResult() {
							return Promise.reject(failure)
						},
						stopWatcher: vi.fn(),
					}
				})
				try {
					await expect(manager.handleSettingsChange()).rejects.toThrow("configured-secret settings failure")
					expect(manager.getCurrentStatus()).toMatchObject({
						systemStatus: "Error",
						message: "[REDACTED] settings failure",
					})
					expect(codeIndexLog.error).toHaveBeenCalledWith(
						"Indexing startup failed",
						expect.objectContaining({ error: failure }),
					)
					expect(internal.startInFlight).toBeUndefined()
				} finally {
					cacheInitialize.mockRestore()
				}
			},
		)

		it.each(["stopIndexing", "stopWatcher"] as const)(
			"does not schedule settings startup after %s",
			async (stop) => {
				const internal = prepare()
				internal._configManager.loadConfiguration = vi.fn().mockResolvedValue({ requiresRestart: true })
				let release!: () => void
				const held = new Promise<void>((resolve) => {
					release = resolve
				})
				const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
				vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
					await held
					internal._orchestrator = replacement
				})
				const settings = manager.handleSettingsChange()
				await Promise.resolve()
				await Promise.resolve()
				await manager[stop]()
				release()
				await settings
				expect(replacement.startIndexing).not.toHaveBeenCalled()
			},
		)
	})

	describe("parser failure lifecycle", () => {
		it("blocks automatic initialize and settings recreation while latched", async () => {
			const internal = manager as any
			internal.parserFailed = true
			internal.parserFailureMessage = "Parsing bad.ts failed; retry or disable indexing"
			internal._configManager = {
				loadConfiguration: vi.fn().mockResolvedValue({ requiresRestart: true }),
				isFeatureEnabled: true,
				isFeatureConfigured: true,
			}
			const recreate = vi.spyOn(internal, "_recreateServices")
			await manager.initialize({} as any)
			await manager.handleSettingsChange()
			expect(recreate).not.toHaveBeenCalled()
			expect(internal._stateManager.setSystemState).toHaveBeenCalledWith("Error", internal.parserFailureMessage)
		})

		it.each(["fatal", "cancel", "disable"])(
			"replaces a stopped service set on explicit restart: %s",
			async (reason) => {
				const internal = manager as any
				internal._configManager = { isFeatureEnabled: true, isFeatureConfigured: true }
				internal._cacheManager = {}
				internal._searchService = {}
				internal._stateManager.getCurrentStatus.mockReturnValue({ systemStatus: "Standby" })
				const old = { startIndexing: vi.fn(), stopIndexing: vi.fn(), stopWatcher: vi.fn(), stopped: true }
				internal._orchestrator = old
				if (reason === "fatal") {
					internal.parserFailed = true
					internal.servicesStopped = true
				} else if (reason === "cancel") manager.stopIndexing()
				else {
					await manager.setWorkspaceEnabled(false)
					await manager.setWorkspaceEnabled(true)
				}
				const replacement = { startIndexing: vi.fn() }
				vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
					internal._orchestrator = replacement
					internal.servicesStopped = false
				})
				await manager.startIndexing()
				expect(internal._recreateServices).toHaveBeenCalledOnce()
				expect(replacement.startIndexing).toHaveBeenCalledOnce()
				expect(old.startIndexing).not.toHaveBeenCalled()
				expect(internal.parserFailed).toBe(false)
				internal._orchestrator = undefined
			},
		)
		// Real post-failure state is Error; the test above forces Standby and so skips recoverFromError.
		it("starts the replacement orchestrator on retry while state is still Error", async () => {
			const internal = manager as any
			internal._configManager = { isFeatureEnabled: true, isFeatureConfigured: true }
			internal._cacheManager = {}
			internal._searchService = {}
			internal._stateManager.getCurrentStatus.mockReturnValue({ systemStatus: "Error" })
			internal._orchestrator = { startIndexing: vi.fn(), stopIndexing: vi.fn() }
			internal.parserFailed = true
			internal.servicesStopped = true
			const replacement = { startIndexing: vi.fn(), stopIndexing: vi.fn() }
			vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				internal._orchestrator = replacement
				internal.servicesStopped = false
			})
			await manager.startIndexing()
			expect(replacement.stopIndexing).not.toHaveBeenCalled()
			expect(replacement.startIndexing).toHaveBeenCalledOnce()
			expect(internal._orchestrator).toBe(replacement)
			internal._orchestrator = undefined
		})
		it.each(["Indexed", "Standby"])("recreates an idle %s service set for an explicit scan", async (state) => {
			const internal = manager as any
			internal._configManager = { isFeatureEnabled: true, isFeatureConfigured: true }
			internal._cacheManager = {}
			internal._searchService = {}
			internal._orchestrator = { state, stopWatcher: vi.fn() }
			const replacement = { startIndexing: vi.fn(), stopWatcher: vi.fn() }
			vi.spyOn(internal, "_recreateServices").mockImplementation(async () => {
				internal._orchestrator = replacement
			})
			await manager.startIndexing()
			expect(replacement.startIndexing).toHaveBeenCalledOnce()
			internal._orchestrator = undefined
		})

		it("idle cancel does not flag live services for automatic recreation", () => {
			const internal = manager as any
			internal._orchestrator = { stopped: false, stopIndexing: vi.fn(() => Promise.resolve()) }
			manager.stopIndexing()
			expect(internal.servicesStopped).toBe(false)
			internal._orchestrator = undefined
		})

		it("returns the orchestrator's shared stop promise unchanged", () => {
			const shared = Promise.resolve()
			const internal = manager as any
			internal._orchestrator = {
				stopIndexing: vi.fn(() => shared),
				stopWatcher: vi.fn(() => shared),
				stopped: true,
			}
			expect(manager.stopIndexing()).toBe(shared)
			expect(manager.stopIndexing()).toBe(shared)
			expect(manager.stopWatcher()).toBe(shared)
			internal._orchestrator = undefined
		})

		it.each(["resolves", "rejects"])("retry waits for an in-flight clear that %s", async (outcome) => {
			const internal = manager as any
			internal._configManager = { isFeatureEnabled: true, isFeatureConfigured: true }
			internal._cacheManager = {}
			internal._searchService = {}
			let settle!: () => void
			const pendingClear = new Promise<void>((resolve, reject) => {
				settle = outcome === "resolves" ? resolve : () => reject(new Error("delete failed"))
			})
			const old = { clearIndexData: vi.fn(() => pendingClear), stopWatcher: vi.fn() }
			internal._orchestrator = old
			const createServices = vi.fn(() => ({
				embedder: {},
				vectorStore: {},
				scanner: {},
				fileWatcher: { dispose: vi.fn() },
			}))
			MockedCodeIndexServiceFactory.mockImplementation(
				() => ({ createServices, validateEmbedder: vi.fn().mockResolvedValue({ valid: true }) }) as any,
			)
			const clear = manager.clearIndexData().catch(() => {})
			// Signal when the retry actually awaits the clear, instead of guessing with a sleep.
			const realClearing = internal.clearing
			let signalAwaiting!: () => void
			const retryAwaitingClear = new Promise<void>((resolve) => (signalAwaiting = resolve))
			internal.clearing = {
				then: (onFulfilled: any, onRejected: any) => {
					signalAwaiting()
					return realClearing.then(onFulfilled, onRejected)
				},
			}
			internal.servicesStopped = true
			const retry = manager.startIndexing()
			let retryFinished = false
			await Promise.race([retryAwaitingClear, retry.then(() => (retryFinished = true))])
			expect(retryFinished).toBe(false)
			for (let tick = 0; tick < 10; tick++) await Promise.resolve()
			expect(createServices).not.toHaveBeenCalled()
			expect(internal._orchestrator).toBeUndefined()
			settle()
			await clear
			await retry
			expect(createServices).toHaveBeenCalledOnce()
			expect(internal._orchestrator).not.toBe(old)
			expect(internal._orchestrator.startIndexing).toHaveBeenCalledOnce()
			internal._orchestrator = undefined
		})

		it("preserves the shared allocator across recreation and fences an old attempt's callbacks", async () => {
			const internal = manager as any
			internal._cacheManager = {}
			internal._configManager = { isFeatureEnabled: true, isFeatureConfigured: true }
			const watcher = { dispose: vi.fn(), initialize: vi.fn() }
			MockedCodeIndexServiceFactory.mockImplementation(
				() =>
					({
						createServices: vi.fn(() => ({
							embedder: {},
							vectorStore: {},
							scanner: {},
							fileWatcher: watcher,
						})),
						validateEmbedder: vi.fn().mockResolvedValue({ valid: true }),
					}) as any,
			)
			await internal._recreateServices()
			const old = internal._orchestrator
			const allocator = internal.generationAllocator
			await internal._recreateServices()
			expect(internal.generationAllocator).toBe(allocator)
			expect(internal._orchestrator.generationAllocator).toBe(allocator)
			expect(MockedCodeIndexServiceFactory.mock.calls.at(-1)?.[4]).toBe(allocator)
			expect(MockedCodeIndexServiceFactory.mock.calls.at(-1)?.[5]).toBe(manager.fileFailureRegistry)
			expect(old.isCurrentAttempt()).toBe(false)
			old.onFatal(new Error("old parser"), "old failure")
			old.onStopped()
			expect(internal.parserFailed).toBe(false)
			expect(internal.servicesStopped).toBe(false)
			internal._orchestrator = undefined
		})
	})

	describe("handleSettingsChange", () => {
		it("should not throw when called on uninitialized manager (regression test)", async () => {
			// This is the core regression test: handleSettingsChange() should not throw
			// when called before the manager is initialized (during first-time configuration)

			// Ensure manager is not initialized
			expect(manager.isInitialized).toBe(false)

			// Mock a minimal config manager that simulates first-time configuration
			const mockConfigManager = {
				loadConfiguration: vi.fn().mockResolvedValue({ requiresRestart: true }),
				isFeatureConfigured: true,
				isFeatureEnabled: true,
				getConfig: vi.fn().mockReturnValue({
					isConfigured: true,
					embedderProvider: "openai",
					modelId: "text-embedding-3-small",
					openAiOptions: { openAiNativeApiKey: "test-key" },
					qdrantUrl: "http://localhost:6333",
					qdrantApiKey: "test-key",
					searchMinScore: 0.4,
				}),
			}
			;(manager as any)._configManager = mockConfigManager

			// Mock cache manager
			const mockCacheManager = {
				initialize: vi.fn(),
				clearCacheFile: vi.fn(),
			}
			;(manager as any)._cacheManager = mockCacheManager

			// Mock the feature state to simulate valid configuration that would normally trigger restart
			vi.spyOn(manager, "isFeatureEnabled", "get").mockReturnValue(true)
			vi.spyOn(manager, "isFeatureConfigured", "get").mockReturnValue(true)

			// Mock service factory to handle _recreateServices call
			const mockServiceFactoryInstance = {
				configManager: mockConfigManager,
				workspacePath: testWorkspacePath,
				cacheManager: mockCacheManager,
				createEmbedder: vi.fn().mockReturnValue({ embedderInfo: { name: "openai" } }),
				createVectorStore: vi.fn().mockReturnValue({}),
				createDirectoryScanner: vi.fn().mockReturnValue({}),
				createFileWatcher: vi.fn().mockReturnValue({
					onDidStartBatchProcessing: vi.fn(),
					onBatchProgressUpdate: vi.fn(),
					watch: vi.fn(),
					stopWatcher: vi.fn(),
					dispose: vi.fn(),
				}),
				createServices: vi.fn().mockReturnValue({
					embedder: { embedderInfo: { name: "openai" } },
					vectorStore: {},
					scanner: {},
					fileWatcher: {
						onDidStartBatchProcessing: vi.fn(),
						onBatchProgressUpdate: vi.fn(),
						watch: vi.fn(),
						stopWatcher: vi.fn(),
						dispose: vi.fn(),
					},
				}),
				validateEmbedder: vi.fn().mockResolvedValue({ valid: true }),
			}
			MockedCodeIndexServiceFactory.mockImplementation(() => mockServiceFactoryInstance as any)

			// The key test: this should NOT throw "CodeIndexManager not initialized" error
			await expect(manager.handleSettingsChange()).resolves.not.toThrow()

			// Verify that loadConfiguration was called (the method should still work)
			expect(mockConfigManager.loadConfiguration).toHaveBeenCalled()
		})

		it("should work normally when manager is initialized", async () => {
			// Mock a complete config manager with all required properties
			const mockConfigManager = {
				loadConfiguration: vi.fn().mockResolvedValue({ requiresRestart: true }),
				isFeatureConfigured: true,
				isFeatureEnabled: true,
				getConfig: vi.fn().mockReturnValue({
					isConfigured: true,
					embedderProvider: "openai",
					modelId: "text-embedding-3-small",
					openAiOptions: { openAiNativeApiKey: "test-key" },
					qdrantUrl: "http://localhost:6333",
					qdrantApiKey: "test-key",
					searchMinScore: 0.4,
				}),
			}
			;(manager as any)._configManager = mockConfigManager

			// Mock cache manager
			const mockCacheManager = {
				initialize: vi.fn(),
				clearCacheFile: vi.fn(),
			}
			;(manager as any)._cacheManager = mockCacheManager

			// Simulate an initialized manager by setting the required properties
			;(manager as any)._orchestrator = { stopWatcher: vi.fn(), stopIndexing: vi.fn() }
			;(manager as any)._searchService = {}

			// Verify manager is considered initialized
			expect(manager.isInitialized).toBe(true)

			// Mock the feature state
			vi.spyOn(manager, "isFeatureEnabled", "get").mockReturnValue(true)
			vi.spyOn(manager, "isFeatureConfigured", "get").mockReturnValue(true)

			// Mock service factory to handle _recreateServices call
			const mockServiceFactoryInstance = {
				configManager: mockConfigManager,
				workspacePath: testWorkspacePath,
				cacheManager: mockCacheManager,
				createEmbedder: vi.fn().mockReturnValue({ embedderInfo: { name: "openai" } }),
				createVectorStore: vi.fn().mockReturnValue({}),
				createDirectoryScanner: vi.fn().mockReturnValue({}),
				createFileWatcher: vi.fn().mockReturnValue({
					onDidStartBatchProcessing: vi.fn(),
					onBatchProgressUpdate: vi.fn(),
					watch: vi.fn(),
					stopWatcher: vi.fn(),
					dispose: vi.fn(),
				}),
				createServices: vi.fn().mockReturnValue({
					embedder: { embedderInfo: { name: "openai" } },
					vectorStore: {},
					scanner: {},
					fileWatcher: {
						onDidStartBatchProcessing: vi.fn(),
						onBatchProgressUpdate: vi.fn(),
						watch: vi.fn(),
						stopWatcher: vi.fn(),
						dispose: vi.fn(),
					},
				}),
				validateEmbedder: vi.fn().mockResolvedValue({ valid: true }),
			}
			MockedCodeIndexServiceFactory.mockImplementation(() => mockServiceFactoryInstance as any)

			// Mock the methods that would be called during restart
			const recreateServicesSpy = vi.spyOn(manager as any, "_recreateServices")

			await manager.handleSettingsChange()

			// Verify that the restart sequence was called
			expect(mockConfigManager.loadConfiguration).toHaveBeenCalled()
			// _recreateServices should be called when requiresRestart is true
			expect(recreateServicesSpy).toHaveBeenCalled()
			// Note: startIndexing is NOT called by handleSettingsChange - it's only called by initialize()
		})

		it("should handle case when config manager is not set", async () => {
			// Ensure config manager is not set (edge case)
			;(manager as any)._configManager = undefined

			// This should not throw an error
			await expect(manager.handleSettingsChange()).resolves.not.toThrow()
		})
	})

	describe("embedder validation integration", () => {
		let mockServiceFactoryInstance: any
		let mockStateManager: any
		let mockEmbedder: any
		let mockVectorStore: any
		let mockScanner: any
		let mockFileWatcher: any

		beforeEach(() => {
			// Mock service factory objects
			mockEmbedder = { embedderInfo: { name: "openai" } }
			mockVectorStore = {}
			mockScanner = {}
			mockFileWatcher = {
				onDidStartBatchProcessing: vi.fn(),
				onBatchProgressUpdate: vi.fn(),
				watch: vi.fn(),
				stopWatcher: vi.fn(),
				dispose: vi.fn(),
			}

			// Mock service factory instance
			mockServiceFactoryInstance = {
				createServices: vi.fn().mockReturnValue({
					embedder: mockEmbedder,
					vectorStore: mockVectorStore,
					scanner: mockScanner,
					fileWatcher: mockFileWatcher,
				}),
				validateEmbedder: vi.fn(),
			}

			// Mock the ServiceFactory constructor
			MockedCodeIndexServiceFactory.mockImplementation(() => mockServiceFactoryInstance)

			// Mock state manager methods directly on the existing instance
			mockStateManager = (manager as any)._stateManager
			mockStateManager.setSystemState = vi.fn()

			// Mock config manager
			const mockConfigManager = {
				loadConfiguration: vitest.fn().mockResolvedValue({ requiresRestart: false }),
				isFeatureConfigured: true,
				isFeatureEnabled: true,
				getConfig: vitest.fn().mockReturnValue({
					isConfigured: true,
					embedderProvider: "openai",
					modelId: "text-embedding-3-small",
					openAiOptions: { openAiNativeApiKey: "test-key" },
					qdrantUrl: "http://localhost:6333",
					qdrantApiKey: "test-key",
					searchMinScore: 0.4,
				}),
			}
			;(manager as any)._configManager = mockConfigManager
		})

		it("recreates services with the saved model before scheduling the overlapping Start", async () => {
			const internal = manager as any
			internal._cacheManager = {}
			const previousConfig = internal._configManager.getConfig()
			const savedConfig = { ...previousConfig, modelId: "saved-model" }
			const builtModels: string[] = []
			let releaseValidation!: () => void
			const validationHeld = new Promise<void>((resolve) => {
				releaseValidation = resolve
			})
			MockedCodeIndexServiceFactory.mockImplementation((configuration) => {
				builtModels.push(configuration.getConfig().modelId!)
				return mockServiceFactoryInstance
			})
			mockServiceFactoryInstance.validateEmbedder
				.mockImplementationOnce(async () => {
					await validationHeld
					return { valid: true }
				})
				.mockResolvedValue({ valid: true })
			const startup = manager.startIndexing()
			await vi.waitFor(() => expect(builtModels).toEqual([previousConfig.modelId]))
			internal._configManager.loadConfiguration.mockImplementation(async () => {
				internal._configManager.getConfig.mockReturnValue(savedConfig)
				return { requiresRestart: true }
			})
			const settings = manager.handleSettingsChange()
			await Promise.resolve()
			await Promise.resolve()
			releaseValidation()
			await Promise.all([startup, settings])
			expect(builtModels).toEqual([previousConfig.modelId, savedConfig.modelId])
			expect(mockServiceFactoryInstance.createServices).toHaveBeenCalledTimes(2)
			const { CodeIndexOrchestrator } = await import("../orchestrator")
			const created = vi.mocked(CodeIndexOrchestrator).mock.results.slice(-2)
			expect(created[0].value.startIndexing).not.toHaveBeenCalled()
			expect(created[1].value.startIndexing).toHaveBeenCalledOnce()
			expect(internal.startupFailureMessage).toBeUndefined()
		})

		it("should validate embedder during _recreateServices when validation succeeds", async () => {
			// Arrange
			mockServiceFactoryInstance.validateEmbedder.mockResolvedValue({ valid: true })

			// Act - directly call the private method for testing
			await (manager as any)._recreateServices()

			// Assert
			expect(mockServiceFactoryInstance.createServices).toHaveBeenCalled()
			const createdEmbedder = mockServiceFactoryInstance.createServices.mock.results[0].value.embedder
			expect(mockServiceFactoryInstance.validateEmbedder).toHaveBeenCalledWith(createdEmbedder)
			expect(mockStateManager.setSystemState).not.toHaveBeenCalledWith("Error", expect.any(String))
		})

		it("T27 forwards the caller signal through the manager to query embedding", async () => {
			mockServiceFactoryInstance.validateEmbedder.mockResolvedValue({ valid: true })
			mockEmbedder.createEmbeddings = vi.fn().mockResolvedValue({ embeddings: [[1, 0]] })
			mockVectorStore.search = vi.fn().mockResolvedValue([])
			mockStateManager.getCurrentStatus.mockReturnValue({ systemStatus: "Indexing" })
			;(manager as any)._cacheManager = {}
			await (manager as any)._recreateServices()
			mockStateManager.setSystemState.mockClear()
			const controller = new AbortController()
			await manager.searchIndex("query", "src", controller.signal)
			expect(mockEmbedder.createEmbeddings).toHaveBeenCalledWith(["query"], undefined, controller.signal)
			expect(mockVectorStore.search).toHaveBeenCalledOnce()
			controller.abort()
			await expect(manager.searchIndex("query", undefined, controller.signal)).rejects.toMatchObject({
				name: "AbortError",
			})
			expect(mockEmbedder.createEmbeddings).toHaveBeenCalledOnce()
			expect(mockStateManager.setSystemState).not.toHaveBeenCalled()
			expect(manager.fileFailureRegistry.list()).toEqual([])
		})

		it("injects the same failure registry into recreated search services", async () => {
			mockServiceFactoryInstance.validateEmbedder.mockResolvedValue({ valid: true })
			mockEmbedder.createEmbeddings = vi.fn().mockResolvedValue({ embeddings: [[1, 0]] })
			mockVectorStore.collectionExists = vi.fn().mockResolvedValue(true)
			mockVectorStore.search = vi.fn().mockResolvedValue([])
			mockStateManager.getCurrentStatus.mockReturnValue({ systemStatus: "Standby" })
			;(manager as any)._cacheManager = {}
			await (manager as any)._recreateServices()
			manager.fileFailureRegistry.renew("failed.ts", "revision")
			manager.fileFailureRegistry.record("failed.ts", "revision", "embed", "failed", 3, "exhausted")
			await expect(manager.searchIndex("query")).resolves.toEqual({
				results: [],
				partial: true,
				failedFiles: ["failed.ts"],
			})
			await (manager as any)._recreateServices()
			await expect(manager.searchIndex("query")).resolves.toEqual({
				results: [],
				partial: true,
				failedFiles: ["failed.ts"],
			})
			manager.fileFailureRegistry.clear("failed.ts")
			mockStateManager.getCurrentStatus.mockReturnValue({ systemStatus: "Indexed" })
			await expect(manager.searchIndex("query")).resolves.toEqual({
				results: [],
				partial: false,
				failedFiles: [],
			})
		})

		it("returns an envelope even when disabled", async () => {
			;(manager as any)._configManager = { isFeatureEnabled: false }
			await expect(manager.searchIndex("query")).resolves.toEqual({
				results: [],
				partial: false,
				failedFiles: [],
			})
			manager.fileFailureRegistry.renew("failed.ts", "revision")
			manager.fileFailureRegistry.record("failed.ts", "revision", "embed", "failed", 3, "exhausted")
			await expect(manager.searchIndex("query")).resolves.toEqual({
				results: [],
				partial: true,
				failedFiles: ["failed.ts"],
			})
		})

		it("should set error state when embedder validation fails", async () => {
			// Arrange
			mockServiceFactoryInstance.validateEmbedder.mockResolvedValue({
				valid: false,
				error: "embeddings:validation.authenticationFailed",
			})

			// Act & Assert
			await expect((manager as any)._recreateServices()).rejects.toThrow(
				"embeddings:validation.authenticationFailed",
			)

			// Assert other expectations
			expect(mockServiceFactoryInstance.createServices).toHaveBeenCalled()
			const createdEmbedder = mockServiceFactoryInstance.createServices.mock.results[0].value.embedder
			expect(mockServiceFactoryInstance.validateEmbedder).toHaveBeenCalledWith(createdEmbedder)
			expect(mockStateManager.setSystemState).toHaveBeenCalledWith(
				"Error",
				"embeddings:validation.authenticationFailed",
			)
		})

		it("should set generic error state when embedder validation throws", async () => {
			// Arrange
			// Since the real service factory catches exceptions, we should mock it to resolve with an error
			mockServiceFactoryInstance.validateEmbedder.mockResolvedValue({
				valid: false,
				error: "embeddings:validation.configurationError",
			})

			// Act & Assert
			await expect((manager as any)._recreateServices()).rejects.toThrow(
				"embeddings:validation.configurationError",
			)

			// Assert other expectations
			expect(mockServiceFactoryInstance.createServices).toHaveBeenCalled()
			const createdEmbedder = mockServiceFactoryInstance.createServices.mock.results[0].value.embedder
			expect(mockServiceFactoryInstance.validateEmbedder).toHaveBeenCalledWith(createdEmbedder)
			expect(mockStateManager.setSystemState).toHaveBeenCalledWith(
				"Error",
				"embeddings:validation.configurationError",
			)
		})

		it("should handle embedder creation failure", async () => {
			// Arrange
			mockServiceFactoryInstance.createServices.mockImplementation(() => {
				throw new Error("Invalid configuration")
			})

			// Act & Assert - should throw the error
			await expect((manager as any)._recreateServices()).rejects.toThrow("Invalid configuration")

			// Should not attempt validation if embedder creation fails
			expect(mockServiceFactoryInstance.validateEmbedder).not.toHaveBeenCalled()
		})
	})

	describe("recoverFromError", () => {
		let mockConfigManager: any
		let mockCacheManager: any
		let mockStateManager: any

		beforeEach(() => {
			// Mock config manager
			mockConfigManager = {
				loadConfiguration: vi.fn().mockResolvedValue({ requiresRestart: false }),
				isFeatureConfigured: true,
				isFeatureEnabled: true,
				getConfig: vi.fn().mockReturnValue({
					isConfigured: true,
					embedderProvider: "openai",
					modelId: "text-embedding-3-small",
					openAiOptions: { openAiNativeApiKey: "test-key" },
					qdrantUrl: "http://localhost:6333",
					qdrantApiKey: "test-key",
					searchMinScore: 0.4,
				}),
			}
			;(manager as any)._configManager = mockConfigManager

			// Mock cache manager
			mockCacheManager = {
				initialize: vi.fn(),
				clearCacheFile: vi.fn(),
			}
			;(manager as any)._cacheManager = mockCacheManager

			// Mock state manager
			mockStateManager = (manager as any)._stateManager
			mockStateManager.setSystemState = vi.fn()
			mockStateManager.getCurrentStatus = vi.fn().mockReturnValue({
				systemStatus: "Error",
				message: "Failed during initial scan: fetch failed",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "items",
			})

			// Mock orchestrator and search service to simulate initialized state
			;(manager as any)._orchestrator = { stopWatcher: vi.fn(), stopIndexing: vi.fn(), state: "Error" }
			;(manager as any)._searchService = {}
			;(manager as any)._serviceFactory = {}
		})

		it("should clear error state when recoverFromError is called", async () => {
			// Act
			await manager.recoverFromError()

			// Assert
			expect(mockStateManager.setSystemState).toHaveBeenCalledWith("Standby", "")
		})

		it("should reset internal service instances", async () => {
			// Verify initial state
			expect((manager as any)._configManager).toBeDefined()
			expect((manager as any)._serviceFactory).toBeDefined()
			expect((manager as any)._orchestrator).toBeDefined()
			expect((manager as any)._searchService).toBeDefined()

			// Act
			await manager.recoverFromError()

			// Assert - all service instances should be undefined
			expect((manager as any)._configManager).toBeUndefined()
			expect((manager as any)._serviceFactory).toBeUndefined()
			expect((manager as any)._orchestrator).toBeUndefined()
			expect((manager as any)._searchService).toBeUndefined()
		})

		it("should make manager report as not initialized after recovery", async () => {
			// Verify initial state
			expect(manager.isInitialized).toBe(true)

			// Act
			await manager.recoverFromError()

			// Assert
			expect(manager.isInitialized).toBe(false)
		})

		it("should allow re-initialization after recovery", async () => {
			// Setup mock for re-initialization
			const mockServiceFactoryInstance = {
				createServices: vi.fn().mockReturnValue({
					embedder: { embedderInfo: { name: "openai" } },
					vectorStore: {},
					scanner: {},
					fileWatcher: {
						onDidStartBatchProcessing: vi.fn(),
						onBatchProgressUpdate: vi.fn(),
						watch: vi.fn(),
						stopWatcher: vi.fn(),
						dispose: vi.fn(),
					},
				}),
				validateEmbedder: vi.fn().mockResolvedValue({ valid: true }),
			}
			MockedCodeIndexServiceFactory.mockImplementation(() => mockServiceFactoryInstance as any)

			// Act - recover from error
			await manager.recoverFromError()

			// Verify manager is not initialized
			expect(manager.isInitialized).toBe(false)

			// Mock context proxy for initialization
			const mockContextProxy = {
				getValue: vi.fn(),
				setValue: vi.fn(),
				storeSecret: vi.fn(),
				getSecret: vi.fn(),
				refreshSecrets: vi.fn().mockResolvedValue(undefined),
				getGlobalState: vi.fn().mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://localhost:6333",
					codebaseIndexEmbedderProvider: "openai",
					codebaseIndexEmbedderModelId: "text-embedding-3-small",
					codebaseIndexEmbedderModelDimension: 1536,
					codebaseIndexSearchMaxResults: 10,
					codebaseIndexSearchMinScore: 0.4,
				}),
			}

			// Enable workspace indexing before re-initialization
			await manager.setWorkspaceEnabled(true)

			// Re-initialize
			await manager.initialize(mockContextProxy as any)

			// Assert - manager should be initialized again
			expect(manager.isInitialized).toBe(true)
			expect(mockServiceFactoryInstance.createServices).toHaveBeenCalled()
			expect(mockServiceFactoryInstance.validateEmbedder).toHaveBeenCalled()
		})

		it("should be safe to call when not in error state (idempotent)", async () => {
			// Setup manager in non-error state
			mockStateManager.getCurrentStatus.mockReturnValue({
				systemStatus: "Standby",
				message: "",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "items",
			})

			// Verify initial state is not error
			const initialStatus = manager.getCurrentStatus()
			expect(initialStatus.systemStatus).not.toBe("Error")

			// Act - call recoverFromError when not in error state
			await expect(manager.recoverFromError()).resolves.not.toThrow()

			// Assert - should still clear state and service instances
			expect(mockStateManager.setSystemState).toHaveBeenCalledWith("Standby", "")
			expect((manager as any)._configManager).toBeUndefined()
			expect((manager as any)._serviceFactory).toBeUndefined()
			expect((manager as any)._orchestrator).toBeUndefined()
			expect((manager as any)._searchService).toBeUndefined()
		})

		it("should continue recovery even if setSystemState throws", async () => {
			// Setup state manager to throw on setSystemState
			mockStateManager.setSystemState.mockImplementation(() => {
				throw new Error("State update failed")
			})

			// Setup manager with service instances
			;(manager as any)._configManager = mockConfigManager
			;(manager as any)._serviceFactory = {}
			;(manager as any)._orchestrator = { stopWatcher: vi.fn(), stopIndexing: vi.fn() }
			;(manager as any)._searchService = {}

			vi.mocked(codeIndexLog.error).mockClear()

			// Act - should not throw despite setSystemState error
			await expect(manager.recoverFromError()).resolves.not.toThrow()

			// Assert - error should be logged
			expect(codeIndexLog.error).toHaveBeenCalledWith("Failed to clear error state during recovery", {
				error: expect.any(Error),
			})

			// Assert - service instances should still be cleared
			expect((manager as any)._configManager).toBeUndefined()
			expect((manager as any)._serviceFactory).toBeUndefined()
			expect((manager as any)._orchestrator).toBeUndefined()
			expect((manager as any)._searchService).toBeUndefined()
		})
	})

	describe("workspace-enabled gating", () => {
		it("should not start indexing when workspace is not enabled", async () => {
			await manager.setAutoEnableDefault(false)

			const mockStateManager = (manager as any)._stateManager
			mockStateManager.setSystemState = vi.fn()
			mockStateManager.getCurrentStatus = vi.fn().mockReturnValue({
				systemStatus: "Standby",
				message: "",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "items",
			})

			expect(manager.isWorkspaceEnabled).toBe(false)

			await manager.startIndexing()

			expect(mockStateManager.setSystemState).not.toHaveBeenCalledWith("Indexing", expect.any(String))
		})

		it("should include workspaceEnabled in getCurrentStatus", async () => {
			await manager.setAutoEnableDefault(false)

			const mockStateManager = (manager as any)._stateManager
			mockStateManager.getCurrentStatus = vi.fn().mockReturnValue({
				systemStatus: "Standby",
				message: "",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "items",
			})

			const status = manager.getCurrentStatus()
			expect(status.workspaceEnabled).toBe(false)
		})

		it("should persist workspace enabled state", async () => {
			await manager.setAutoEnableDefault(false)
			expect(manager.isWorkspaceEnabled).toBe(false)

			await manager.setWorkspaceEnabled(true)
			expect(manager.isWorkspaceEnabled).toBe(true)

			await manager.setWorkspaceEnabled(false)
			expect(manager.isWorkspaceEnabled).toBe(false)
		})

		it("should store enablement per folder URI, not per window", async () => {
			CodeIndexManager.disposeAll()

			const vscode = await import("vscode")

			const folderAPath = path.join(path.sep, "test", "folderA")
			const folderBPath = path.join(path.sep, "test", "folderB")
			const folderAUri = mockUri(folderAPath)
			const folderBUri = mockUri(folderBPath)

			// Both folders share the same workspaceState (same window)
			const sharedStore: Record<string, any> = {}
			const sharedContext = {
				...mockContext,
				workspaceState: {
					get: vi.fn((key: string, defaultValue?: any) => sharedStore[key] ?? defaultValue),
					update: vi.fn(async (key: string, value: any) => {
						sharedStore[key] = value
					}),
				} as any,
				globalState: {
					get: vi.fn((_key: string, _defaultValue?: any) => false),
					update: vi.fn(),
				} as any,
			}

			// Patch workspaceFolders to include both folders
			;(vscode.workspace as any).workspaceFolders = [
				{ uri: folderAUri, name: "folderA", index: 0 },
				{ uri: folderBUri, name: "folderB", index: 1 },
			]

			const managerA = CodeIndexManager.getInstance(sharedContext as any, folderAPath)!
			const managerB = CodeIndexManager.getInstance(sharedContext as any, folderBPath)!

			// Both start disabled (autoEnableDefault is false via globalState mock)
			expect(managerA.isWorkspaceEnabled).toBe(false)
			expect(managerB.isWorkspaceEnabled).toBe(false)

			// Enable A only
			await managerA.setWorkspaceEnabled(true)

			expect(managerA.isWorkspaceEnabled).toBe(true)
			expect(managerB.isWorkspaceEnabled).toBe(false)

			// Enable B, disable A
			await managerB.setWorkspaceEnabled(true)
			await managerA.setWorkspaceEnabled(false)

			expect(managerA.isWorkspaceEnabled).toBe(false)
			expect(managerB.isWorkspaceEnabled).toBe(true)

			CodeIndexManager.disposeAll()
		})
	})

	describe("stopIndexing", () => {
		it("should delegate to orchestrator.stopIndexing()", () => {
			const mockOrchestrator = {
				stopIndexing: vi.fn(),
				stopWatcher: vi.fn(),
				state: "Indexing",
			}
			;(manager as any)._orchestrator = mockOrchestrator

			manager.stopIndexing()

			expect(mockOrchestrator.stopIndexing).toHaveBeenCalled()
		})

		it("should be safe to call when orchestrator is not set", () => {
			;(manager as any)._orchestrator = undefined

			expect(() => manager.stopIndexing()).not.toThrow()
		})
	})

	describe("handleSettingsChange - disable toggle bug fix", () => {
		it("should abort active indexing when feature is disabled", async () => {
			const mockOrchestrator = {
				stopIndexing: vi.fn(),
				stopWatcher: vi.fn(),
				state: "Indexing",
			}
			;(manager as any)._orchestrator = mockOrchestrator

			const mockConfigManager = {
				loadConfiguration: vi.fn().mockResolvedValue({ requiresRestart: false }),
				isFeatureConfigured: true,
				isFeatureEnabled: false,
			}
			;(manager as any)._configManager = mockConfigManager

			const mockStateManager = (manager as any)._stateManager
			mockStateManager.setSystemState = vi.fn()

			await manager.handleSettingsChange()

			expect(mockOrchestrator.stopWatcher).toHaveBeenCalled()
			expect(mockStateManager.setSystemState).not.toHaveBeenCalled()
		})
	})
})
