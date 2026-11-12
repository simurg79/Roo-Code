import "../../__tests__/mock-discovery"
import "../../__tests__/mock-code-index-log"
import * as vscode from "vscode"
import path from "path"
import { createHash } from "crypto"
import { FileWatcher } from "../file-watcher"
import { DirectoryScanner } from "../scanner"
import { listFiles } from "../../../glob/list-files"
import { stat } from "fs/promises"
import { CodeIndexOrchestrator } from "../../orchestrator"
import { GenerationAllocator } from "../../generation-allocator"
import { IndexWriteGate, LATE_WRITE_GRACE_MS } from "../../index-write-gate"
import { ParserFatalError } from "../../parser-errors"
import { CodeBlock } from "../../interfaces"
import { MAX_BLOCK_CHARS, MAX_FILE_SIZE_BYTES, PARSE_TIMEOUT_MS, INDEX_STOP_LIMIT_MS } from "../../constants"
import { CodeIndexOllamaEmbedder } from "../../embedders/ollama"
import { QdrantVectorStore } from "../../vector-store/qdrant-client"
import { EventEmitter } from "node:events"
import { ParseWorkerClient, type ParseRequest } from "../../parse-worker-client"
import { CodeParser } from "../parser"
import { CacheManager } from "../../cache-manager"
import { safeWriteJson } from "../../../../utils/safeWriteJson"
import { FileCompletion } from "../../file-completion"
import { FileFailureRegistry } from "../../file-failure-registry"
import { codeIndexLog } from "../../code-index-log"
import { ProviderPacerRegistry } from "../../provider-pacer"
import { definePacingContracts } from "./pacing-contracts"

// Use this spec's workspace double, not the setup-time VS Code module.
vi.hoisted(() => vi.resetModules())

vi.mock("../../../../utils/safeWriteJson", () => ({ safeWriteJson: vi.fn() }))
vi.mock("../../../glob/list-files", () => ({ listFiles: vi.fn() }))
vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	return { ...actual, stat: vi.fn() }
})

vi.mock("../../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: vi.fn().mockImplementation(() => ({ initialize: vi.fn(), validateAccess: () => true })),
}))
vi.mock("../../processors", () => ({}))
vi.mock("../../../../i18n", () => ({ t: (key: string) => key }))
vi.mock("vscode", () => ({
	window: { activeTextEditor: undefined },
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
		createFileSystemWatcher: vi.fn(),
		getWorkspaceFolder: vi.fn(),
		fs: { stat: vi.fn(), readFile: vi.fn() },
	},
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
	Uri: {
		file: (filePath: string) => ({ fsPath: filePath }),
		joinPath: (base: { fsPath: string }, relative: string) => ({ fsPath: path.join(base.fsPath, relative) }),
	},
	EventEmitter: class {
		private listeners = new Set<(value: unknown) => void>()
		event = (listener: (value: unknown) => void) => {
			this.listeners.add(listener)
			return { dispose: () => this.listeners.delete(listener) }
		}
		fire = vi.fn((value: unknown) => {
			for (const listener of this.listeners) listener(value)
		})
		dispose() {
			this.listeners.clear()
		}
	},
}))

function deferred<Value = void>() {
	let resolve!: (value: Value) => void
	let reject!: (error: Error) => void
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete
		reject = fail
	})
	return { promise, resolve, reject }
}

async function drain() {
	for (let iter = 0; iter < 150; iter++) await Promise.resolve()
}

class ControlledWorker extends EventEmitter {
	requests: ParseRequest[] = []
	terminate = vi.fn(async () => 0)
	postMessage(request: ParseRequest) {
		this.requests.push(request)
	}
}

const workspace = path.resolve("/mock/workspace")
const fileA = path.join(workspace, "a.ts")
const fileB = path.join(workspace, "b.ts")
const hash = (content: string) => createHash("sha256").update(content).digest("hex")

function blocks(filePath = fileA, count = 1): CodeBlock[] {
	return Array.from({ length: count }, (_, index) => ({
		file_path: filePath,
		identifier: null,
		type: "function",
		start_line: 1,
		end_line: 1,
		content: `${path.basename(filePath)} block ${index}`,
		fileHash: "hash",
		segmentHash: `${filePath}:${index}`,
	}))
}

describe("FileWatcher per-file completion", () => {
	let cache: any
	let store: any
	let embedder: any
	let parser: any
	let ignore: any
	let access: any
	let gate: IndexWriteGate
	let generations: GenerationAllocator
	let watcher: FileWatcher
	let watchers: FileWatcher[]
	let handlers: Record<string, (uri: any) => void>
	let disk: { hashes: Record<string, string>; open: Record<string, true> }
	let hashes: Record<string, string>
	let open: Record<string, true>
	let points: Map<string, any>
	let contents: Map<string, string>
	let progress: ReturnType<typeof vi.fn>
	let finished: ReturnType<typeof vi.fn>
	let fatal: ReturnType<typeof vi.fn>
	let state: any
	let orchestrator: CodeIndexOrchestrator

	let failures: FileFailureRegistry
	let pacers: ProviderPacerRegistry

	function makeWatcher() {
		failures = new FileFailureRegistry()
		const created = new FileWatcher(
			workspace,
			{} as any,
			cache,
			embedder,
			store,
			ignore,
			1,
			parser,
			gate,
			generations,
			failures,
			undefined,
			pacers,
		)
		watchers.push(created)
		return created
	}

	function applyDelete(filePath: string, generation: number) {
		const relative = path.relative(workspace, filePath)
		for (const [pointId, point] of points) {
			if (
				point.payload.filePath === relative &&
				(point.payload.generation === undefined || point.payload.generation < generation)
			)
				points.delete(pointId)
		}
	}

	async function start(
		worker: { stop(): void; stopped: Promise<void> } = { stop: vi.fn(), stopped: Promise.resolve() },
		isCurrentAttempt = () => true,
		reuseState = false,
	) {
		let status = "Standby"
		if (!reuseState)
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
		orchestrator = new CodeIndexOrchestrator(
			{ isFeatureConfigured: true } as any,
			state,
			workspace,
			cache,
			store,
			{
				scanDirectory: vi.fn().mockResolvedValue({ stats: { processed: 0, skipped: 0 }, totalBlockCount: 0 }),
			} as any,
			watcher,
			worker,
			fatal,
			undefined,
			gate,
			generations,
			isCurrentAttempt,
			failures,
			pacers,
		)
		await orchestrator.startIndexing()
		expect(state.state).toBe(Object.keys(cache.getOpenFiles()).length ? "Standby" : "Indexed")
	}

	async function useRealCache() {
		let persisted: unknown = { version: 2, generationWatermark: 0, fileHashes: {}, openFiles: {} }
		vi.mocked(safeWriteJson).mockImplementation(async (_filePath, value) => {
			persisted = structuredClone(value)
		})
		vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) =>
			Buffer.from(
				uri.fsPath.includes("roo-index-cache-") ? JSON.stringify(persisted) : contents.get(uri.fsPath)!,
			),
		)
		const context = { globalStorageUri: { fsPath: path.join(workspace, "storage") } } as any
		const reload = async () => {
			const loaded = new CacheManager(context, workspace)
			await loaded.initialize()
			gate.recover(Object.keys(loaded.getOpenFiles()), loaded.loadedAt)
			return loaded
		}
		cache = await reload()
		generations = new GenerationAllocator(cache)
		watcher.dispose()
		watcher = makeWatcher()
		watcher.onBatchProgressUpdate(progress)
		watcher.onDidFinishBatchProcessing(finished)
		return reload
	}

	async function queue(filePaths = [fileA], type = "change") {
		for (const filePath of filePaths) handlers[type]({ fsPath: filePath })
		await vi.advanceTimersByTimeAsync(500)
		await drain()
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(safeWriteJson).mockReset()
		vi.useFakeTimers()
		vi.setSystemTime(0)
		watchers = []
		pacers = new ProviderPacerRegistry()
		handlers = {}
		hashes = {}
		open = {}
		disk = { hashes: {}, open: {} }
		points = new Map()
		contents = new Map([
			[fileA, "content a"],
			[fileB, "content b"],
		])
		cache = {
			generationWatermark: 0,
			getHash: vi.fn((filePath) => hashes[filePath]),
			getOpenFiles: vi.fn(() => ({ ...open })),
			isTracked: vi.fn((filePath) => Object.hasOwn(hashes, filePath) || Object.hasOwn(open, filePath)),
			getTrackedPaths: vi.fn(() => [...new Set([...Object.keys(hashes), ...Object.keys(open)])]),
			reserveGenerations: vi.fn(async (watermark) => {
				cache.generationWatermark = watermark
			}),
			invalidateFile: vi.fn(async (filePath) => {
				delete hashes[filePath]
				open[filePath] = true
				disk = { hashes: { ...hashes }, open: { ...open } }
			}),
			completeFile: vi.fn((filePath, newHash) => {
				hashes[filePath] = newHash
				delete open[filePath]
			}),
			completeRemoval: vi.fn((filePath) => {
				delete hashes[filePath]
				delete open[filePath]
			}),
			clearCacheFile: vi.fn(),
		}
		store = {
			rateLimitScope: "qdrant:watcher-test",
			initialize: vi.fn().mockResolvedValue(false),
			markIndexingIncomplete: vi.fn(),
			markIndexingComplete: vi.fn(),
			upsertPoints: vi.fn(async (batch) => {
				for (const point of batch) points.set(point.id, point)
			}),
			deletePointsByFilePath: vi.fn(async (filePath, generation) => applyDelete(filePath, generation)),
			countPointsForFile: vi.fn(async (filePath, generation) => {
				const selected = [...points.values()].filter(
					(point) => point.payload.filePath === path.relative(workspace, filePath),
				)
				return {
					current: selected.filter((point) => point.payload.generation === generation).length,
					other: selected.filter((point) => point.payload.generation !== generation).length,
				}
			}),
		}
		embedder = {
			rateLimitScope: "openai:watcher-test",
			createEmbeddings: vi.fn(async (texts: string[]) => ({ embeddings: texts.map(() => [1, 2, 3]) })),
		}
		parser = { parseFile: vi.fn(async (filePath) => blocks(filePath)) }
		ignore = { ignores: vi.fn(() => false) }
		access = { validateAccess: vi.fn(() => true) }
		gate = new IndexWriteGate()
		generations = new GenerationAllocator(cache)
		vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({ size: 1000 } as any)
		vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) =>
			Buffer.from(contents.get(uri.fsPath) ?? "content"),
		)
		vi.mocked(vscode.workspace.createFileSystemWatcher).mockImplementation(
			() =>
				({
					onDidCreate: (handler: any) => {
						handlers.create = handler
					},
					onDidChange: (handler: any) => {
						handlers.change = handler
					},
					onDidDelete: (handler: any) => {
						handlers.delete = handler
					},
					dispose: vi.fn(),
				}) as any,
		)
		watcher = makeWatcher()
		progress = vi.fn()
		finished = vi.fn()
		fatal = vi.fn()
		watcher.onBatchProgressUpdate(progress)
		watcher.onDidFinishBatchProcessing(finished)
	})

	afterEach(() => {
		for (const created of watchers) created.dispose()
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	definePacingContracts(
		() => ({
			paths: [
				fileA,
				fileB,
				path.join(workspace, "c.ts"),
				...Array.from({ length: 197 }, (_, fileNumber) => path.join(workspace, `pacing-${fileNumber}.ts`)),
			],
			embedder,
			store,
			parser,
			pacers,
			failures,
			start: async (paths) => {
				await start()
				await queue(paths)
			},
			finish: async () => {
				await drain()
				expect(watcher.isProcessing).toBe(false)
				expect(state.state).toBe(failures.list().length ? "Standby" : "Indexed")
			},
			getStatus: () => ({ state: state.state, message: state.setSystemState.mock.calls.at(-1)?.[1] }),
			getHash: (filePath) => hashes[filePath],
			getPoints: (filePath) =>
				[...points.values()].filter((point) => point.payload.filePath === path.relative(workspace, filePath)),
			seed: (filePath) => {
				points.set("obsolete", {
					id: "obsolete",
					vector: [0],
					payload: {
						filePath: path.relative(workspace, filePath),
						generation: 0,
					},
				})
			},
		}),
		vi,
	)

	it("recovers a watcher store request without another event and retains every retry in grouped diagnostics", async () => {
		store.upsertPoints.mockRejectedValueOnce(Object.assign(new Error("unavailable"), { status: 503 }))
		store.upsertPoints.mockRejectedValueOnce(Object.assign(new Error("unavailable"), { status: 503 }))
		await watcher.initialize()
		await queue()
		await vi.advanceTimersByTimeAsync(1500 + LATE_WRITE_GRACE_MS)
		expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
		expect(store.upsertPoints).toHaveBeenCalledTimes(3)
		expect(hashes[fileA]).toBe(hash("content a"))
		expect(failures.list()).toEqual([])
		const batch = vi.mocked(codeIndexLog.createFailureBatch).mock.results.at(-1)!.value
		expect(batch.record.mock.calls.map(([failure]: any[]) => failure.attempt)).toEqual([1, 2])
		expect(batch.flush).toHaveBeenCalledOnce()
	})

	it.each(["read", "parse", "fatal"])(
		"records watcher %s failures including fatal before disposal",
		async (activity) => {
			if (activity === "read")
				vi.mocked(vscode.workspace.fs.readFile).mockRejectedValueOnce(new Error("read failed"))
			else
				parser.parseFile.mockRejectedValueOnce(
					activity === "fatal" ? new ParserFatalError("parser-abort", fileA) : new Error("parse failed"),
				)
			const pending = watcher.processFile(fileA)
			if (activity === "fatal") await expect(pending).rejects.toBeInstanceOf(ParserFatalError)
			else expect((await pending).status).toBe("local_error")
			expect(failures.list()[0]).toMatchObject({
				path: "a.ts",
				activity: activity === "read" ? "read" : "parse",
				attempt: 1,
				state: "exhausted",
			})
		},
	)

	describe("T43 watcher source missing at read is a removal", () => {
		const missing = (code: string) => Object.assign(new Error("gone"), { code })
		const failAt = (stage: "stat" | "read", error: Error) => {
			if (stage === "stat") vi.mocked(vscode.workspace.fs.stat).mockRejectedValueOnce(error)
			else vi.mocked(vscode.workspace.fs.readFile).mockRejectedValueOnce(error)
		}
		const pointsFor = (filePath: string) =>
			[...points.values()].filter((point) => point.payload.filePath === path.relative(workspace, filePath))

		it.each(["stat", "read"] as const)("never-indexed file missing at %s is skipped", async (stage) => {
			failAt(stage, missing("FileNotFound"))
			expect(await watcher.processFile(fileA)).toMatchObject({ status: "skipped" })
			expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
			expect(failures.list()).toEqual([])
		})

		it.each(["stat", "read"] as const)("previously indexed file missing at %s is removed", async (stage) => {
			expect(await watcher.processFile(fileA)).toMatchObject({ status: "success" })
			expect(pointsFor(fileA)).not.toEqual([])
			failAt(stage, missing(stage === "stat" ? "FileNotFound" : "ENOENT"))
			expect(await watcher.processFile(fileA)).toMatchObject({ status: "success" })
			expect(pointsFor(fileA)).toEqual([])
			expect(hashes[fileA]).toBeUndefined()
			expect(failures.list()).toEqual([])
		})

		it("clears a prior failure for a path found missing", async () => {
			parser.parseFile.mockRejectedValueOnce(new Error("parse failed"))
			await watcher.processFile(fileA)
			expect(failures.list()).toHaveLength(1)
			failAt("stat", missing("FileNotFound"))
			expect(await watcher.processFile(fileA)).toMatchObject({ status: "success" })
			expect(failures.list()).toEqual([])
		})

		it("keeps a cleanup failure as a delete failure", async () => {
			await watcher.processFile(fileA)
			failAt("read", missing("FileNotFound"))
			store.deletePointsByFilePath.mockRejectedValueOnce(new Error("delete failed"))
			expect(await watcher.processFile(fileA)).toMatchObject({ status: "local_error" })
			expect(failures.list()).toEqual([expect.objectContaining({ path: "a.ts", activity: "delete" })])
		})

		it.each([
			["stat", "NoPermissions"],
			["read", "EACCES"],
			["read", "Unknown"],
		] as const)("keeps denied access at %s (%s) as a read failure", async (stage, code) => {
			failAt(stage, missing(code))
			expect(await watcher.processFile(fileA)).toMatchObject({ status: "local_error" })
			expect(failures.list()).toEqual([
				expect.objectContaining({ path: "a.ts", activity: "read", state: "exhausted" }),
			])
		})

		it("keeps a not-found error from setup, outside stat and read, as a failure", async () => {
			vi.spyOn(watcher as any, "getContext").mockRejectedValueOnce(missing("ENOENT"))
			expect(await watcher.processFile(fileA)).toMatchObject({ status: "local_error" })
			expect(failures.list()).toEqual([expect.objectContaining({ path: "a.ts", activity: "read" })])
		})

		it.each(
			(["stat", "read"] as const).flatMap((stage) =>
				(["new", "indexed", "failed"] as const).flatMap((history) =>
					(["during", "after"] as const).map((timing) => ({ stage, history, timing })),
				),
			),
		)(
			"removes $history source missing at $stage $timing a concurrent provider wait",
			async ({ stage, history, timing }) => {
				await start()
				if (history === "indexed") await queue()
				if (history === "failed") {
					points.set("obsolete", {
						id: "obsolete",
						vector: [0],
						payload: { filePath: "a.ts", generation: 0 },
					})
					failures.renew("a.ts", "old")
					failures.record("a.ts", "old", "read", "read failed", 1, "exhausted")
				}
				const metadata = deferred<any>()
				vi.mocked(vscode.workspace.fs.stat).mockImplementation(async (uri) =>
					uri.fsPath === fileA ? metadata.promise : ({ size: 100 } as any),
				)
				const readFile = vi.mocked(vscode.workspace.fs.readFile).getMockImplementation()!
				const missingRead = vi.fn()
				vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) => {
					if (uri.fsPath === fileA) {
						missingRead()
						throw missing("FileNotFound")
					}
					return readFile(uri)
				})
				embedder.createEmbeddings
					.mockClear()
					.mockRejectedValueOnce(Object.assign(new Error("limited"), { status: 429, retryAfterMs: 30_000 }))
				finished.mockClear()
				await queue([fileA, fileB])
				expect(pacers.waitingPaths()).toContain("b.ts")
				expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
				expect(missingRead).not.toHaveBeenCalled()
				expect(finished).not.toHaveBeenCalled()
				expect(state.state).toBe("Indexing")
				const resumeAt = pacers.providerWaits()[0].resumeAt!
				await vi.advanceTimersByTimeAsync(resumeAt - Date.now() - (timing === "during" ? 1 : 0))
				if (stage === "stat") metadata.reject(missing("FileNotFound"))
				else metadata.resolve({ size: 100 })
				await drain()
				expect(missingRead).toHaveBeenCalledTimes(stage === "read" ? 1 : 0)
				if (timing === "during") {
					expect(pacers.waitingPaths()).toContain("b.ts")
					expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
					expect(finished).not.toHaveBeenCalled()
					await vi.advanceTimersByTimeAsync(1)
				}
				await drain()
				expect(finished).toHaveBeenCalledExactlyOnceWith({
					processedFiles: expect.arrayContaining([
						{
							path: fileA,
							status: history === "new" ? "skipped" : "success",
							...(history === "new" ? { reason: "File is not tracked" } : {}),
						},
						{ path: fileB, status: "success" },
					]),
					batchError: undefined,
				})
				expect(pointsFor(fileA)).toEqual([])
				expect(hashes[fileA]).toBeUndefined()
				expect(pointsFor(fileB)).toHaveLength(1)
				expect(hashes[fileB]).toBe(hash("content b"))
				expect(failures.list()).toEqual([])
				expect(pacers.waitingPaths()).toEqual([])
				expect(watcher.isProcessing).toBe(false)
				expect(state.state).toBe("Indexed")
				if (history === "new")
					expect(store.deletePointsByFilePath).not.toHaveBeenCalledWith(fileA, expect.anything())
				else expect(store.deletePointsByFilePath).toHaveBeenCalledWith(fileA, expect.any(Number))
			},
		)

		it("indexes a recreated file normally", async () => {
			await watcher.processFile(fileA)
			failAt("read", missing("FileNotFound"))
			await watcher.processFile(fileA)
			expect(pointsFor(fileA)).toEqual([])
			expect(await watcher.processFile(fileA)).toMatchObject({ status: "success" })
			expect(pointsFor(fileA)).not.toEqual([])
			expect(hashes[fileA]).toBe(hash("content a"))
		})
	})

	it("retains exhausted budgets across batches and renews only the hashed changed path", async () => {
		embedder.createEmbeddings.mockRejectedValue(Object.assign(new Error("unavailable"), { status: 503 }))
		await watcher.initialize()
		await queue()
		await vi.advanceTimersByTimeAsync(1500)
		expect(embedder.createEmbeddings).toHaveBeenCalledTimes(3)
		await queue()
		expect(embedder.createEmbeddings).toHaveBeenCalledTimes(3)
		await queue([fileB])
		await vi.advanceTimersByTimeAsync(1500)
		expect(embedder.createEmbeddings).toHaveBeenCalledTimes(6)
		await queue([fileA])
		expect(embedder.createEmbeddings).toHaveBeenCalledTimes(6)
		contents.set(fileA, "new content")
		await queue([fileA])
		await vi.advanceTimersByTimeAsync(1500)
		expect(embedder.createEmbeddings).toHaveBeenCalledTimes(9)
		expect(failures.list()).toHaveLength(2)
	})

	it("aborts a path retry on a newer event before renewing its hash and leaves another path alone", async () => {
		embedder.createEmbeddings.mockRejectedValue(Object.assign(new Error("unavailable"), { status: 503 }))
		await watcher.initialize()
		await queue([fileA, fileB])
		const oldSignal = embedder.createEmbeddings.mock.calls.find(([texts]: string[][]) =>
			texts[0].startsWith("a.ts"),
		)[2]
		contents.set(fileA, "new revision")
		handlers.change({ fsPath: fileA })
		expect(oldSignal.aborted).toBe(true)
		expect(failures.getRevision("a.ts")).toBe(hash("content a"))
		await vi.advanceTimersByTimeAsync(1500)
		await vi.advanceTimersByTimeAsync(500)
		expect(failures.getRevision("a.ts")).toBe(hash("new revision"))
		expect(failures.get("b.ts")).toMatchObject({ revision: hash("content b"), attempt: 3, state: "exhausted" })
	})

	it("attempts fenced removal for a registry-only deleted source", async () => {
		failures.renew("a.ts", "unread")
		failures.record("a.ts", "unread", "read", "read failed", 1, "exhausted")
		await watcher.initialize()
		await queue([fileA], "delete")
		expect(store.deletePointsByFilePath).toHaveBeenCalledWith(fileA, expect.any(Number))
		expect(failures.list()).toEqual([])
	})

	it.each(["cancel", "disable", "fatal"])(
		"T5 retains A independently while B hangs on %s and skips A on retry",
		async (stop) => {
			const held = deferred<CodeBlock[]>()
			parser.parseFile.mockImplementation(async (filePath: string) =>
				filePath === fileB ? held.promise : blocks(filePath),
			)
			await start()
			await queue([fileA, fileB])
			expect(hashes[fileA]).toBe(hash("content a"))
			expect(hashes[fileB]).toBeUndefined()
			expect(progress).toHaveBeenCalledWith({ processedInBatch: 1, totalInBatch: 2, currentFile: fileA })
			if (stop === "fatal") held.reject(new ParserFatalError("parser-abort", fileB))
			else if (stop === "disable") await orchestrator.stopWatcher()
			else await orchestrator.stopIndexing()
			await drain()
			if (stop === "fatal") expect(state.state).toBe("Error")
			else held.resolve(blocks(fileB))
			watcher = makeWatcher()
			await start()
			embedder.createEmbeddings.mockClear()
			await queue([fileA])
			expect(embedder.createEmbeddings).not.toHaveBeenCalled()
		},
	)

	it("T6/T18 waits for every batch and verification before hashing or reporting completion", async () => {
		const held = deferred<any>()
		parser.parseFile.mockResolvedValue(blocks(fileA, 3))
		embedder.createEmbeddings
			.mockResolvedValueOnce({ embeddings: [[1]] })
			.mockImplementationOnce(() => held.promise)
		await start()
		await queue()
		expect(store.upsertPoints).toHaveBeenCalledOnce()
		expect(hashes[fileA]).toBeUndefined()
		expect(open[fileA]).toBe(true)
		expect(progress.mock.calls.map(([value]) => value.processedInBatch)).toEqual([0])
		expect(finished).not.toHaveBeenCalled()
		held.resolve({ embeddings: [[2]] })
		await drain()
		expect(store.upsertPoints).toHaveBeenCalledTimes(3)
		expect(hashes[fileA]).toBe(hash("content a"))
		expect(state.state).toBe("Indexed")
	})

	it("T18 registers every batch before the first embedding can settle", async () => {
		const registered = vi.spyOn(FileCompletion.prototype, "registered")
		const register = vi.spyOn(FileCompletion.prototype, "register")
		const held = deferred<any>()
		parser.parseFile.mockResolvedValue(blocks(fileA, 3))
		embedder.createEmbeddings
			.mockImplementationOnce(async () => {
				expect(register).toHaveBeenCalledTimes(3)
				expect(registered).toHaveBeenCalledOnce()
				const completion = registered.mock.contexts[0] as FileCompletion
				expect(completion.registrationComplete).toBe(true)
				expect(completion.outstanding).toBe(3)
				return { embeddings: [[1]] }
			})
			.mockImplementationOnce(() => held.promise)
		try {
			await start()
			await queue()
			expect(store.upsertPoints).toHaveBeenCalledOnce()
			expect((registered.mock.contexts[0] as FileCompletion).outstanding).toBe(2)
			expect(hashes[fileA]).toBeUndefined()
			expect(store.countPointsForFile).not.toHaveBeenCalled()
			held.resolve({ embeddings: [[1]] })
			await drain()
			expect(store.upsertPoints).toHaveBeenCalledTimes(3)
			expect(hashes[fileA]).toBe(hash("content a"))
		} finally {
			registered.mockRestore()
			register.mockRestore()
		}
	})

	it("T6 refuses subsequent batches after a successful upsert is followed by cancellation", async () => {
		parser.parseFile.mockResolvedValue(blocks(fileA, 3))
		await start()
		const upsert = store.upsertPoints.getMockImplementation()!
		store.upsertPoints.mockImplementationOnce(async (batch: any[]) => {
			await upsert(batch)
			void orchestrator.stopIndexing()
		})
		await queue()
		expect(points.size).toBe(1)
		expect(store.upsertPoints).toHaveBeenCalledOnce()
		expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
		expect(hashes[fileA]).toBeUndefined()
		expect(open[fileA]).toBe(true)
		expect(gate.needsReconciliation(fileA)).toBe(false)
		watcher = makeWatcher()
		await start()
		await queue()
		expect(points.size).toBe(3)
		expect(hashes[fileA]).toBe(hash("content a"))
	})

	it("T6/T11 interrupted partial replacement has no durable hash; retry restores every block", async () => {
		parser.parseFile.mockResolvedValue(blocks(fileA, 3))
		embedder.createEmbeddings
			.mockResolvedValueOnce({ embeddings: [[1]] })
			.mockRejectedValueOnce(new Error("provider failed"))
		await start()
		await queue()
		expect(hashes[fileA]).toBeUndefined()
		expect(disk).toEqual({ hashes: {}, open: { [fileA]: true } })
		expect(points.size).toBe(1)
		expect(finished.mock.calls[0][0].processedFiles[0].status).toBe("local_error")
		expect(state.state).toBe("Standby")
		watcher.dispose()
		hashes = { ...disk.hashes }
		open = { ...disk.open }
		watcher = makeWatcher()
		await start()
		await queue()
		expect(points.size).toBe(3)
		expect(open[fileA]).toBeUndefined()
	})

	it.each(["success", "failure", "abort"])(
		"dispose cancels the real embed signal and discards late %s",
		async (outcome) => {
			const held = deferred<any>()
			parser.parseFile.mockResolvedValue(blocks(fileA, 2))
			embedder.createEmbeddings.mockImplementation(() => held.promise)
			await start()
			await queue()
			const signal = embedder.createEmbeddings.mock.calls[0][2]
			const stopped = orchestrator.stopIndexing()
			await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS)
			await stopped
			expect(signal.aborted).toBe(true)
			if (outcome === "success") held.resolve({ embeddings: [[1]] })
			else held.reject(outcome === "abort" ? new DOMException("cancelled", "AbortError") : new Error("failed"))
			await drain()
			expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
			expect(store.upsertPoints).not.toHaveBeenCalled()
			expect(cache.completeFile).not.toHaveBeenCalled()
			expect(finished).not.toHaveBeenCalled()
			expect(progress).toHaveBeenCalledTimes(1)
		},
	)

	it("reports fatal immediately without waiting for another file and suppresses queued events", async () => {
		const held = deferred<CodeBlock[]>()
		parser.parseFile.mockImplementation(async (filePath: string) => {
			if (filePath === fileA) throw new ParserFatalError("parse-timeout", fileA)
			return held.promise
		})
		await start()
		await queue([fileA, fileB])
		expect(fatal).toHaveBeenCalledOnce()
		expect(state.state).toBe("Error")
		const calls = parser.parseFile.mock.calls.length
		await queue([path.join(workspace, "later.ts")])
		expect(parser.parseFile).toHaveBeenCalledTimes(calls)
		held.resolve(blocks(fileB))
		await drain()
		expect(finished).not.toHaveBeenCalled()
		expect(store.upsertPoints).not.toHaveBeenCalled()
	})

	it("bounds concurrency and starts the next file as soon as one finishes", async () => {
		const held = deferred<CodeBlock[]>()
		const paths = Array.from({ length: 12 }, (_, index) => path.join(workspace, `${index}.ts`))
		parser.parseFile.mockImplementation(async (filePath: string) => (filePath === paths[0] ? [] : held.promise))
		await watcher.initialize()
		await queue(paths)
		expect(parser.parseFile).toHaveBeenCalledTimes(11)
		expect(hashes[paths[0]]).toBeDefined()
		expect(watcher.isProcessing).toBe(true)
		watcher.dispose()
		held.resolve([])
		await drain()
	})

	it("isProcessing is already true in the start callback so stop detects the batch", async () => {
		await start()
		watcher.onDidStartBatchProcessing(() => {
			expect(watcher.isProcessing).toBe(true)
			void orchestrator.stopIndexing()
		})
		await queue()
		expect(state.setSystemState).toHaveBeenCalledWith("Stopping", expect.any(String), "stop")
		expect(embedder.createEmbeddings).not.toHaveBeenCalled()
	})

	it("T14 uses fresh generations and distinct segment IDs on successive edits", async () => {
		await start()
		parser.parseFile.mockResolvedValueOnce(blocks(fileA, 3)).mockResolvedValueOnce(blocks(fileA, 1))
		await queue()
		const first = [...points.values()]
		expect(new Set(first.map((point) => point.id)).size).toBe(3)
		contents.set(fileA, "edited")
		await queue()
		expect(points.size).toBe(1)
		const current = [...points.values()][0]
		expect(current.payload.generation).toBeGreaterThan(first[0].payload.generation)
		expect(current.id).not.toBe(first[0].id)
		expect(store.deletePointsByFilePath.mock.invocationCallOrder[0]).toBeGreaterThan(
			store.upsertPoints.mock.invocationCallOrder[0],
		)
	})

	it.each([
		{ current: 0, other: 0 },
		{ current: 1, other: 1 },
	])("rejects verification mismatch %j without false completed progress", async (counts) => {
		store.countPointsForFile.mockResolvedValue(counts)
		await start()
		await queue()
		expect(cache.completeFile).not.toHaveBeenCalled()
		expect(progress.mock.calls.map(([value]) => value.processedInBatch)).toEqual([0])
		expect(finished.mock.calls[0][0].batchError).toBeInstanceOf(Error)
		expect(state.state).toBe("Standby")
	})

	it("T17 awaits durable invalidation before any embeddings or mutations", async () => {
		const saved = deferred()
		cache.invalidateFile.mockImplementationOnce(async (filePath: string) => {
			delete hashes[filePath]
			open[filePath] = true
			await saved.promise
			disk = { hashes: { ...hashes }, open: { ...open } }
		})
		hashes[fileA] = "old hash"
		await start()
		await queue()
		expect(embedder.createEmbeddings).not.toHaveBeenCalled()
		expect(store.upsertPoints).not.toHaveBeenCalled()
		expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
		saved.resolve()
		await drain()
		expect(disk).toEqual({ hashes: {}, open: { [fileA]: true } })
		expect(hashes[fileA]).toBe(hash("content a"))
	})

	it("T17 fresh cache at first mutation dispatch sees awaited durable invalidation", async () => {
		const reload = await useRealCache()
		cache.completeFile(fileA, "previous revision")
		await cache.flush()
		await start()
		const saved = deferred()
		const write = vi.mocked(safeWriteJson).getMockImplementation()!
		vi.mocked(safeWriteJson).mockImplementationOnce(async (filePath, value) => {
			await saved.promise
			await write(filePath, value)
		})
		const dispatched = deferred()
		let atDispatch: CacheManager | undefined
		store.upsertPoints.mockImplementationOnce(async () => {
			atDispatch = await reload()
			await dispatched.promise
		})
		await queue()
		expect(store.upsertPoints).not.toHaveBeenCalled()
		expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
		expect(embedder.createEmbeddings).not.toHaveBeenCalled()
		expect((await reload()).getHash(fileA)).toBe("previous revision")
		saved.resolve()
		await drain()
		expect(store.upsertPoints).toHaveBeenCalledOnce()
		expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
		expect(atDispatch).toBeInstanceOf(CacheManager)
		expect(atDispatch!.getHash(fileA)).toBeUndefined()
		expect(atDispatch!.getOpenFiles()).toEqual({ [fileA]: true })
		const stopped = orchestrator.stopWatcher()
		dispatched.resolve()
		await stopped
		await drain()
	})

	it.each(["invalidation", "allocation"])(
		"T17 %s failure issues no mutation and reports an incomplete batch",
		async (failure) => {
			if (failure === "invalidation") cache.invalidateFile.mockRejectedValue(new Error("disk full"))
			else vi.spyOn(generations, "allocate").mockRejectedValue(new Error("disk full"))
			await start()
			await queue()
			expect(embedder.createEmbeddings).not.toHaveBeenCalled()
			expect(store.upsertPoints).not.toHaveBeenCalled()
			expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
			expect(finished.mock.calls[0][0].batchError).toBeInstanceOf(Error)
			expect(failures.list()).toEqual([
				expect.objectContaining({ path: "a.ts", activity: "upsert", reason: "disk full", state: "exhausted" }),
			])
			expect(state.state).toBe("Standby")
		},
	)

	it.each(["delete", "ignore", "rooignore", "size"])("T21 cleans tracked open paths on %s", async (exclusion) => {
		open[fileA] = true
		points.set("legacy", { payload: { filePath: path.relative(workspace, fileA) } })
		if (exclusion === "ignore") ignore.ignores.mockReturnValue(true)
		if (exclusion === "rooignore") {
			const { createDiscoveryContext } = await import("../../../glob/discovery-options")
			vi.mocked(createDiscoveryContext).mockResolvedValueOnce({
				workspaceRoot: workspace,
				options: { respectGitignore: true, followSymlinks: false },
				includedRoots: [],
				rooIgnore: { ignores: () => true },
			} as any)
		}
		if (exclusion === "size")
			vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({ size: MAX_FILE_SIZE_BYTES + 1 } as any)
		await start()
		await queue([fileA], exclusion === "delete" ? "delete" : "change")
		expect(points.size).toBe(0)
		expect(cache.invalidateFile).toHaveBeenCalledWith(fileA)
		expect(store.deletePointsByFilePath).toHaveBeenCalledWith(fileA, expect.any(Number))
		expect(cache.completeRemoval).toHaveBeenCalledWith(fileA)
		expect(open[fileA]).toBeUndefined()
		expect(parser.parseFile).not.toHaveBeenCalled()
	})

	it.each(["create", "change", "delete"])("ignores untracked hidden paths on %s events", async (eventType) => {
		await watcher.initialize()
		const paths = [".git/config", ".hidden/file.ts", "src/.cache/file.ts", "node_modules/package/index.js"]
		await queue(
			paths.map((relative) => path.join(workspace, relative)),
			eventType,
		)
		expect(parser.parseFile).not.toHaveBeenCalled()
		expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
		expect(finished.mock.calls[0][0].processedFiles).toHaveLength(paths.length)
	})

	it("T21 invalidates a completed file before removal and preserves its open record on failure", async () => {
		hashes[fileA] = hash("content a")
		store.deletePointsByFilePath.mockRejectedValueOnce(new Error("lost result"))
		await start()
		await queue([fileA], "delete")
		expect(hashes[fileA]).toBeUndefined()
		expect(disk).toEqual({ hashes: {}, open: { [fileA]: true } })
		expect(cache.completeRemoval).not.toHaveBeenCalled()
		expect(finished.mock.calls[0][0].processedFiles[0].status).toBe("local_error")
		watcher.dispose()
		hashes = { ...disk.hashes }
		open = { ...disk.open }
		const retry = makeWatcher()
		await retry.initialize()
		const pending = retry.processFile(fileA)
		await drain()
		await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS)
		expect((await pending).status).toBe("success")
		expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
		expect(hashes[fileA]).toBe(hash("content a"))
	})

	it.each(["delete", "ignore"])(
		"T21 completed %s removal waits for the real cache save barrier",
		async (eventType) => {
			const reload = await useRealCache()
			cache.completeFile(fileA, hash("content a"))
			await cache.flush()
			points.set("completed", { payload: { filePath: path.relative(workspace, fileA), generation: 0 } })
			await start()
			const saved = deferred()
			const write = vi.mocked(safeWriteJson).getMockImplementation()!
			vi.mocked(safeWriteJson).mockImplementationOnce(async (filePath, value) => {
				await saved.promise
				await write(filePath, value)
			})
			let atDispatch: CacheManager | undefined
			store.deletePointsByFilePath.mockImplementationOnce(async (filePath: string, generation: number) => {
				atDispatch = await reload()
				applyDelete(filePath, generation)
			})
			if (eventType === "ignore") ignore.ignores.mockReturnValue(true)
			await queue([fileA], eventType === "delete" ? "delete" : "change")
			expect(cache.getHash(fileA)).toBeUndefined()
			expect(cache.getOpenFiles()).toEqual({ [fileA]: true })
			expect((await reload()).getHash(fileA)).toBe(hash("content a"))
			expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
			expect(points.size).toBe(1)
			expect(finished).not.toHaveBeenCalled()
			saved.resolve()
			await drain()
			expect(atDispatch!.getHash(fileA)).toBeUndefined()
			expect(atDispatch!.getOpenFiles()).toEqual({ [fileA]: true })
			expect(store.deletePointsByFilePath).toHaveBeenCalledOnce()
			expect(points.size).toBe(0)
			expect(cache.getOpenFiles()).toEqual({})
			await cache.flush()
			const completed = await reload()
			expect(completed.getHash(fileA)).toBeUndefined()
			expect(completed.getOpenFiles()).toEqual({})
		},
	)

	it("T21 removal save failure issues no delete", async () => {
		hashes[fileA] = "completed"
		cache.invalidateFile.mockRejectedValueOnce(new Error("disk full"))
		await start()
		await queue([fileA], "delete")
		expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
		expect(cache.completeRemoval).not.toHaveBeenCalled()
		expect(finished.mock.calls[0][0].batchError).toBeInstanceOf(Error)
	})

	it.each(["replacement", "removal", "exclusion"])(
		"T10 late old %s cleanup cannot delete a recreated generation",
		async (kind) => {
			const held = deferred()
			hashes[fileA] = "old"
			store.deletePointsByFilePath.mockImplementationOnce(async (filePath: string, generation: number) => {
				await held.promise
				applyDelete(filePath, generation)
			})
			await start()
			if (kind === "exclusion") ignore.ignores.mockReturnValue(true)
			await queue([fileA], kind === "removal" ? "delete" : "change")
			expect(disk.open[fileA]).toBe(true)
			const stopped = orchestrator.stopIndexing()
			await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS)
			await stopped
			ignore.ignores.mockReturnValue(false)
			watcher = makeWatcher()
			await start()
			await queue()
			await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS)
			expect(hashes[fileA]).toBe(hash("content a"))
			const current = [...points.keys()]
			held.resolve()
			await drain()
			expect([...points.keys()]).toEqual(current)
			expect(hashes[fileA]).toBe(hash("content a"))
		},
	)

	it.each(["clean", "late", "cancel"])(
		"T12 grace keeps progress incomplete until re-verification: %s",
		async (outcome) => {
			gate.recover([fileA], Date.now())
			await start()
			await queue()
			expect(hashes[fileA]).toBeUndefined()
			expect(open[fileA]).toBe(true)
			expect(finished).not.toHaveBeenCalled()
			expect(progress.mock.calls.map(([value]) => value.processedInBatch)).toEqual([0])
			expect(state.state).toBe("Indexing")
			if (outcome === "late") {
				const current = [...points.values()][0]
				points.set("old write", { ...current, id: "old write", payload: { ...current.payload, generation: 0 } })
			}
			if (outcome === "cancel") {
				await orchestrator.stopIndexing()
				await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS)
				expect(finished).not.toHaveBeenCalled()
				expect(hashes[fileA]).toBeUndefined()
				expect(state.state).toBe("Standby")
				return
			}
			await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS - 501)
			expect(hashes[fileA]).toBeUndefined()
			await vi.advanceTimersByTimeAsync(1)
			await drain()
			if (outcome === "clean") {
				expect(hashes[fileA]).toBe(hash("content a"))
				expect(state.state).toBe("Indexed")
			} else {
				expect(hashes[fileA]).toBeUndefined()
				expect(state.state).toBe("Standby")
				failures.resetAllBudgets()
				await queue()
				expect(points.size).toBe(1)
				expect(hashes[fileA]).toBe(hash("content a"))
			}
		},
	)

	it("T12 late shared-key upsert before initial verification preserves current points but refuses completion", async () => {
		const remote = deferred()
		let lateWrite!: Promise<void>
		store.upsertPoints.mockImplementationOnce(async (batch: any[]) => {
			lateWrite = remote.promise.then(() => {
				for (const point of batch) points.set(point.id, point)
			})
			throw new Error("local timeout")
		})
		await start()
		await queue()
		const deadline = Date.now() + LATE_WRITE_GRACE_MS
		expect(gate.graceDeadline(fileA)).toBe(deadline)
		const cleanup = deferred()
		store.deletePointsByFilePath.mockImplementationOnce(async (filePath: string, generation: number) => {
			applyDelete(filePath, generation)
			await cleanup.promise
		})
		failures.resetAllBudgets()
		await queue()
		expect(store.countPointsForFile).not.toHaveBeenCalled()
		const current = [...points.values()][0]
		remote.resolve()
		await lateWrite
		expect(points.get(current.id)).toBe(current)
		expect(new Set([...points.values()].map((point) => point.payload.segmentHash)).size).toBe(1)
		expect(points.size).toBe(2)
		cleanup.resolve()
		await drain()
		expect(store.countPointsForFile).toHaveBeenCalledOnce()
		expect(hashes[fileA]).toBeUndefined()
		expect(open[fileA]).toBe(true)
		expect(finished.mock.calls.at(-1)![0].batchError).toBeInstanceOf(Error)
		expect(progress.mock.calls.every(([value]) => value.processedInBatch === 0)).toBe(true)
		failures.resetAllBudgets()
		await queue()
		await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1)
		expect(hashes[fileA]).toBeUndefined()
		await vi.advanceTimersByTimeAsync(1)
		expect(points.size).toBe(1)
		expect(hashes[fileA]).toBe(hash("content a"))
	})

	it("T12 stop-expiry uncertainty starts grace at the exact watcher stop deadline", async () => {
		const held = deferred()
		store.upsertPoints.mockImplementationOnce(() => held.promise)
		await start()
		await queue()
		const expiresAt = Date.now() + INDEX_STOP_LIMIT_MS
		const stopped = orchestrator.stopIndexing()
		await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS - 1)
		expect(gate.graceDeadline(fileA)).toBe(0)
		await vi.advanceTimersByTimeAsync(1)
		await stopped
		expect(Date.now()).toBe(expiresAt)
		const deadline = expiresAt + LATE_WRITE_GRACE_MS
		expect(gate.graceDeadline(fileA)).toBe(deadline)
		watcher = makeWatcher()
		await start()
		await queue()
		await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1)
		expect(hashes[fileA]).toBeUndefined()
		expect(open[fileA]).toBe(true)
		expect(state.state).toBe("Indexing")
		await vi.advanceTimersByTimeAsync(1)
		expect(hashes[fileA]).toBe(hash("content a"))
		expect(state.state).toBe("Indexed")
		held.resolve()
		await drain()
		expect(gate.needsReconciliation(fileA)).toBe(false)
	})

	it("T12 recovered open-file grace starts at real cache load completion, not later watcher startup", async () => {
		const reload = await useRealCache()
		await cache.invalidateFile(fileA)
		await vi.advanceTimersByTimeAsync(1234)
		const read = vi.mocked(vscode.workspace.fs.readFile).getMockImplementation()!
		const loaded = deferred()
		vi.mocked(vscode.workspace.fs.readFile).mockImplementationOnce(async (uri) => {
			await loaded.promise
			return read(uri)
		})
		const reloading = reload()
		await vi.advanceTimersByTimeAsync(1000)
		loaded.resolve()
		cache = await reloading
		const loadedAt = cache.loadedAt
		expect(loadedAt).toBe(2234)
		await vi.advanceTimersByTimeAsync(5000)
		generations = new GenerationAllocator(cache)
		watcher.dispose()
		watcher = makeWatcher()
		await start()
		const deadline = loadedAt + LATE_WRITE_GRACE_MS
		expect(gate.graceDeadline(fileA)).toBe(deadline)
		await queue()
		await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1)
		expect(cache.getHash(fileA)).toBeUndefined()
		expect(cache.getOpenFiles()).toEqual({ [fileA]: true })
		expect(finished).not.toHaveBeenCalled()
		expect(state.state).toBe("Indexing")
		await vi.advanceTimersByTimeAsync(1)
		expect(cache.getHash(fileA)).toBe(hash("content a"))
		expect(cache.getOpenFiles()).toEqual({})
		expect(state.state).toBe("Indexed")
		await cache.flush()
	})

	it("T12 a locally rejected old upsert arrives remotely during retry grace and fails re-verification", async () => {
		const remote = deferred()
		let lateWrite!: Promise<void>
		store.upsertPoints.mockImplementationOnce(async (batch: any[]) => {
			lateWrite = remote.promise.then(() => {
				for (const point of batch) points.set(point.id, point)
			})
			throw new Error("local timeout")
		})
		await start()
		await queue()
		expect(hashes[fileA]).toBeUndefined()
		failures.resetAllBudgets()
		await queue()
		const current = [...points.values()][0]
		remote.resolve()
		await lateWrite
		expect(points.get(current.id)).toBe(current)
		await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS)
		expect(hashes[fileA]).toBeUndefined()
		expect(finished.mock.calls.at(-1)![0].batchError).toBeInstanceOf(Error)
		failures.resetAllBudgets()
		await queue()
		expect(points.size).toBe(1)
		expect(hashes[fileA]).toBe(hash("content a"))
	})

	it.each(["failed cleanup", "partial upsert"])(
		"T11 real cache reload keeps %s open and retry restores verified content",
		async (failure) => {
			const reload = await useRealCache()
			cache.completeFile(fileA, "previous revision")
			await cache.flush()
			if (failure === "failed cleanup")
				store.deletePointsByFilePath.mockRejectedValueOnce(new Error("delete failed"))
			else {
				parser.parseFile.mockResolvedValue(blocks(fileA, 3))
				embedder.createEmbeddings
					.mockResolvedValueOnce({ embeddings: [[1]] })
					.mockRejectedValueOnce(new Error("provider failed after first upsert"))
			}
			await start()
			await queue()
			expect(points.size).toBe(1)
			expect(cache.getHash(fileA)).toBeUndefined()
			expect(finished.mock.calls[0][0].processedFiles[0].status).toBe("local_error")
			await orchestrator.stopWatcher()
			cache = await reload()
			expect(cache.getHash(fileA)).toBeUndefined()
			expect(cache.getOpenFiles()[fileA]).toBe(true)
			generations = new GenerationAllocator(cache)
			watcher = makeWatcher()
			await start()
			await queue()
			expect(cache.getHash(fileA)).toBeUndefined()
			await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS)
			expect(points.size).toBe(failure === "partial upsert" ? 3 : 1)
			expect(cache.getHash(fileA)).toBe(hash("content a"))
			expect(cache.getOpenFiles()).toEqual({})
			expect(state.state).toBe("Indexed")
			await cache.flush()
			const completed = await reload()
			expect(completed.getHash(fileA)).toBe(hash("content a"))
			expect(completed.getOpenFiles()).toEqual({})
		},
	)

	it.each(["delete", "ignore"])(
		"T21 real cache reload replaces identical content after a lost %s result",
		async (eventType) => {
			let persisted: any = { version: 2, generationWatermark: 0, fileHashes: {}, openFiles: {} }
			vi.mocked(safeWriteJson).mockImplementation(async (_filePath, value) => {
				persisted = JSON.parse(JSON.stringify(value))
			})
			vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) => {
				return Buffer.from(uri.fsPath.includes("roo-index-cache-") ? JSON.stringify(persisted) : "content a")
			})
			const context = { globalStorageUri: { fsPath: path.join(workspace, "storage") } } as any
			cache = new CacheManager(context, workspace)
			await cache.initialize()
			cache.completeFile(fileA, hash("content a"))
			await cache.flush()
			points.set("original", { payload: { filePath: path.relative(workspace, fileA), generation: 0 } })
			generations = new GenerationAllocator(cache)
			watcher = makeWatcher()
			await start()
			if (eventType === "ignore") ignore.ignores.mockReturnValue(true)
			const lostResult = deferred()
			store.deletePointsByFilePath.mockImplementationOnce(async (filePath: string, generation: number) => {
				applyDelete(filePath, generation)
				await lostResult.promise
			})
			await queue([fileA], eventType === "delete" ? "delete" : "change")
			expect(points.size).toBe(0)
			expect(persisted.fileHashes[path.relative(workspace, fileA)]).toBeUndefined()
			expect(persisted.openFiles[path.relative(workspace, fileA)]).toBe(true)
			watcher.dispose()
			cache = new CacheManager(context, workspace)
			await cache.initialize()
			gate.recover(Object.keys(cache.getOpenFiles()), cache.loadedAt)
			expect(cache.getHash(fileA)).toBeUndefined()
			expect(cache.getTrackedPaths()).toContain(fileA)
			ignore.ignores.mockReturnValue(false)
			generations = new GenerationAllocator(cache)
			await generations.initialize(store, new AbortController().signal, gate)
			watcher = makeWatcher()
			await start()
			await queue()
			expect(cache.getHash(fileA)).toBeUndefined()
			await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS + INDEX_STOP_LIMIT_MS)
			expect(state.state).toBe("Indexed")
			expect(points.size).toBe(1)
			expect(cache.getHash(fileA)).toBe(hash("content a"))
			expect(cache.getOpenFiles()).toEqual({})
			lostResult.resolve()
			await drain()
			expect(cache.getHash(fileA)).toBe(hash("content a"))
			await cache.flush()
		},
	)

	it("T12 a rejected upsert starts grace and another uncertainty extends it", async () => {
		store.upsertPoints.mockRejectedValueOnce(new Error("timeout"))
		await start()
		await queue()
		expect(gate.needsReconciliation(fileA)).toBe(true)
		failures.resetAllBudgets()
		await queue()
		await vi.advanceTimersByTimeAsync(10_000)
		gate.recover([fileA], Date.now())
		await vi.advanceTimersByTimeAsync(20_000)
		expect(hashes[fileA]).toBeUndefined()
		await vi.advanceTimersByTimeAsync(10_000)
		expect(hashes[fileA]).toBe(hash("content a"))
	})

	it("T24 after-window stale extras preserve current points and the next edit removes them", async () => {
		gate.recover([fileA], Date.now())
		await start()
		await queue([fileA, fileB])
		await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS)
		const current = [...points.values()].find((point) => point.payload.filePath === "a.ts")!
		const otherFile = [...points.values()].find((point) => point.payload.filePath === "b.ts")!
		const late = deferred()
		const oldWrite = late.promise.then(() => {
			points.set("late", { ...current, id: "late", payload: { ...current.payload, generation: 0 } })
		})
		late.resolve()
		await oldWrite
		expect(points.has(current.id)).toBe(true)
		expect(points.has(otherFile.id)).toBe(true)
		contents.set(fileA, "edit after late arrival")
		await queue()
		expect(points.size).toBe(2)
		expect(points.has("late")).toBe(false)
		expect(points.has(otherFile.id)).toBe(true)
	})

	it("coalesces revisions and processes events arriving during a batch in the next batch", async () => {
		const held = deferred<CodeBlock[]>()
		parser.parseFile.mockImplementationOnce(() => held.promise)
		await watcher.initialize()
		await queue()
		contents.set(fileA, "latest")
		handlers.change({ fsPath: fileA })
		handlers.change({ fsPath: fileA })
		await vi.advanceTimersByTimeAsync(500)
		expect(parser.parseFile).toHaveBeenCalledOnce()
		held.resolve(blocks())
		await drain()
		await vi.advanceTimersByTimeAsync(500)
		expect(parser.parseFile).toHaveBeenCalledTimes(2)
		expect(hashes[fileA]).toBe(hash("latest"))
	})

	it("T4 explicit retry starts a new scan and watcher; repeated fatal attempts remain bounded", async () => {
		parser.parseFile.mockRejectedValue(new ParserFatalError("parser-abort", fileA))
		for (let attempt = 0; attempt < 2; attempt++) {
			if (attempt) watcher = makeWatcher()
			await start()
			await queue()
			expect(state.state).toBe("Error")
			expect(fatal).toHaveBeenCalledTimes(attempt + 1)
			await orchestrator.stopIndexing()
			await queue()
			expect(parser.parseFile).toHaveBeenCalledTimes(attempt + 1)
		}
		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2)
	})

	it("T5 completed A survives cancellation of B's deferred embedding and is skipped on retry", async () => {
		const held = deferred<any>()
		embedder.createEmbeddings.mockImplementation(async (texts: string[]) =>
			texts[0].startsWith("b.ts") ? held.promise : { embeddings: [[1]] },
		)
		await start()
		await queue([fileA, fileB])
		expect(hashes[fileA]).toBe(hash("content a"))
		expect(hashes[fileB]).toBeUndefined()
		const stopped = orchestrator.stopIndexing()
		await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS)
		await stopped
		held.resolve({ embeddings: [[1]] })
		await drain()
		expect([...points.values()].every((point) => point.payload.filePath === "a.ts")).toBe(true)
		watcher = makeWatcher()
		await start()
		embedder.createEmbeddings.mockClear()
		await queue([fileA])
		expect(embedder.createEmbeddings).not.toHaveBeenCalled()
	})

	it("T9 cancellation drops queued files as well as late in-flight embeddings", async () => {
		const held = deferred<any>()
		embedder.createEmbeddings.mockImplementation(() => held.promise)
		await start()
		const paths = Array.from({ length: 12 }, (_, fileNumber) => path.join(workspace, `${fileNumber}.ts`))
		await queue(paths)
		expect(embedder.createEmbeddings).toHaveBeenCalledTimes(10)
		const stopped = orchestrator.stopIndexing()
		await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS)
		await stopped
		for (const call of embedder.createEmbeddings.mock.calls) expect(call[2].aborted).toBe(true)
		held.resolve({ embeddings: [[1]] })
		await drain()
		expect(embedder.createEmbeddings).toHaveBeenCalledTimes(10)
		expect(parser.parseFile).toHaveBeenCalledTimes(10)
		expect(store.upsertPoints).not.toHaveBeenCalled()
		expect(cache.completeFile).not.toHaveBeenCalled()
	})

	it.each(["abort", "hang"])("T1/T2/T8 real watcher worker %s fail-stops once with no cascade", async (failure) => {
		const worker = new ControlledWorker()
		const client = new ParseWorkerClient(() => worker)
		parser = client
		watcher.dispose()
		watcher = makeWatcher()
		await start(client)
		await queue([fileA, fileB])
		expect(worker.requests.map((request) => request.filePath)).toEqual([fileA])
		const probe = vi.fn()
		setTimeout(probe, 100)
		await vi.advanceTimersByTimeAsync(100)
		expect(probe).toHaveBeenCalledOnce()
		if (failure === "hang") {
			await vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS - 101)
			expect(state.state).toBe("Indexing")
			await vi.advanceTimersByTimeAsync(1)
		} else {
			worker.emit("message", { id: worker.requests[0].id, error: { fatal: true, message: "Aborted()" } })
		}
		await drain()
		expect(fatal).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				filePath: fileA,
				category: failure === "hang" ? "parse-timeout" : "parser-abort",
			}),
			"embeddings:orchestrator.parserFailed",
		)
		expect(state.state).toBe("Error")
		const updates = state.setSystemState.mock.calls.length
		await queue([fileB])
		worker.emit("message", { id: worker.requests[0].id, blocks: blocks() })
		worker.emit("exit", 1)
		await orchestrator.stopIndexing()
		await orchestrator.startIndexing()
		expect(state.setSystemState).toHaveBeenCalledTimes(updates)
		expect(worker.requests).toHaveLength(1)
		expect(worker.terminate).toHaveBeenCalledOnce()
		expect(store.upsertPoints).not.toHaveBeenCalled()
		expect(cache.clearCacheFile).not.toHaveBeenCalled()
	})

	it.each(["cancel", "disable"])("T3/T7/T19 %s during real watcher hang is shared and bounded", async (action) => {
		const worker = new ControlledWorker()
		const client = new ParseWorkerClient(() => worker)
		parser = client
		watcher.dispose()
		watcher = makeWatcher()
		await start(client)
		await queue([fileA, fileB])
		const stopped = action === "cancel" ? orchestrator.stopIndexing() : orchestrator.stopWatcher()
		expect(orchestrator.stopIndexing()).toBe(stopped)
		expect(orchestrator.stopWatcher()).toBe(stopped)
		expect(state.state).toBe("Stopping")
		await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS - 1)
		expect(state.state).toBe("Stopping")
		await vi.advanceTimersByTimeAsync(1)
		await stopped
		expect(state.setSystemState).toHaveBeenLastCalledWith(
			"Standby",
			"embeddings:orchestrator.indexingStoppedPartial",
			"stop",
		)
		await queue([fileB])
		expect(worker.requests).toHaveLength(1)
		expect(worker.terminate).toHaveBeenCalledOnce()
		worker.emit("exit", 1)
		await client.stopped
	})

	it("T7 fully settled watcher stop reports stopped rather than partial", async () => {
		const exit = deferred()
		const worker = { stop: vi.fn(), stopped: exit.promise }
		const ownership = vi.spyOn(gate, "own")
		await start(worker)
		await queue()
		expect(hashes[fileA]).toBeDefined()
		const write = deferred()
		const pending = gate.run(ownership.mock.calls[0][1], () => write.promise).catch((error) => error)
		await drain()
		const stopped = orchestrator.stopIndexing()
		expect(state.state).toBe("Stopping")
		write.resolve()
		await pending
		await drain()
		expect(state.state).toBe("Stopping")
		exit.resolve()
		await stopped
		expect(state.setSystemState).toHaveBeenLastCalledWith(
			"Standby",
			"embeddings:orchestrator.indexingStopped",
			"stop",
		)
	})

	it("T8 idle cancel preserves watcher status and message; disable blocks later events", async () => {
		await start()
		state.setSystemState.mockClear()
		await orchestrator.stopIndexing()
		expect(state.setSystemState).not.toHaveBeenCalled()
		await orchestrator.stopWatcher()
		await queue()
		expect(state.setSystemState).not.toHaveBeenCalled()
		expect(parser.parseFile).not.toHaveBeenCalled()
	})

	it.each(["none", "late", "late-reject", "late-abort", "cancel-prior", "cancel-grace", "settled", "unrelated"])(
		"T12/T19 actual watcher pre-expiry retry completion barrier: %s",
		async (outcome) => {
			const held = deferred()
			let oldPoints: any[] = []
			store.upsertPoints.mockImplementationOnce(async (batch: any[]) => {
				oldPoints = batch
				if (outcome === "settled") for (const point of batch) points.set(point.id, point)
				await held.promise
			})
			let oldIsCurrent = true
			await start(undefined, () => oldIsCurrent)
			await queue()
			expect(store.upsertPoints).toHaveBeenCalledOnce()
			const old = orchestrator
			const expiryAt = Date.now() + INDEX_STOP_LIMIT_MS
			const stopped = old.stopIndexing()
			expect(state.state).toBe("Stopping")
			oldIsCurrent = false
			await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS - 502)
			const verified: { at: number; counts: { current: number; other: number } }[] = []
			const count = store.countPointsForFile.getMockImplementation()!
			store.countPointsForFile.mockImplementation(async (filePath: string, generation: number) => {
				const counts = await count(filePath, generation)
				if (filePath === fileA) verified.push({ at: Date.now(), counts })
				return counts
			})
			watcher = makeWatcher()
			const retryProgress = vi.fn()
			const retryFinished = vi.fn()
			watcher.onBatchProgressUpdate(retryProgress)
			watcher.onDidFinishBatchProcessing(retryFinished)
			await start(undefined, () => true, true)
			state.reportFileQueueProgress.mockClear()
			await queue(outcome === "unrelated" ? [fileA, fileB] : [fileA])
			const completedFiles = outcome === "unrelated" ? 1 : 0
			const currentIds = [...points.values()]
				.filter((point) => point.payload.filePath === path.relative(workspace, fileA))
				.map((point) => point.id)
			const unrelatedIds = [...points.values()]
				.filter((point) => point.payload.filePath === path.relative(workspace, fileB))
				.map((point) => point.id)
			const assertIncomplete = () => {
				expect(hashes[fileA]).toBeUndefined()
				expect(open[fileA]).toBe(true)
				expect(state.state).toBe("Indexing")
				expect(watcher.isProcessing).toBe(true)
				expect(retryFinished).not.toHaveBeenCalled()
				expect(retryProgress.mock.calls.every(([value]) => value.processedInBatch <= completedFiles)).toBe(true)
				expect(
					state.reportFileQueueProgress.mock.calls.every(
						([processed]: number[]) => processed <= completedFiles,
					),
				).toBe(true)
				if (outcome === "unrelated") {
					expect(hashes[fileB]).toBe(hash("content b"))
					expect(
						[...points.values()]
							.filter((point) => point.payload.filePath === path.relative(workspace, fileB))
							.map((point) => point.id),
					).toEqual(unrelatedIds)
					expect(state.reportFileQueueProgress).toHaveBeenCalledWith(1, 2, "b.ts", "changed-file-batch")
				}
			}
			expect(verified).toEqual([{ at: expiryAt - 2, counts: { current: 1, other: 0 } }])
			expect(currentIds).toHaveLength(1)
			expect(store.upsertPoints).toHaveBeenCalledTimes(outcome === "unrelated" ? 3 : 2)
			expect(gate.graceDeadline(fileA)).toBe(0)
			assertIncomplete()
			if (outcome === "settled") {
				await vi.advanceTimersByTimeAsync(1)
				held.resolve()
				await drain()
				await stopped
				expect(Date.now()).toBe(expiryAt - 1)
				expect(hashes[fileA]).toBe(hash("content a"))
				expect(gate.needsReconciliation(fileA)).toBe(false)
				expect(verified.at(-1)).toEqual({ at: expiryAt - 1, counts: { current: 1, other: 0 } })
				expect(state.state).toBe("Indexed")
				expect(retryFinished).toHaveBeenCalledOnce()
				return
			}
			if (outcome === "cancel-prior") {
				await orchestrator.stopIndexing()
				await drain()
				expect(state.setSystemState).toHaveBeenLastCalledWith(
					"Standby",
					"embeddings:orchestrator.indexingStoppedPartial",
					"stop",
				)
				expect(hashes[fileA]).toBeUndefined()
				expect(open[fileA]).toBe(true)
				expect(retryFinished).not.toHaveBeenCalled()
				await vi.advanceTimersByTimeAsync(2)
				await stopped
				return
			}
			await vi.advanceTimersByTimeAsync(1)
			assertIncomplete()
			expect(gate.graceDeadline(fileA)).toBe(0)
			await vi.advanceTimersByTimeAsync(1)
			await stopped
			let deadline = expiryAt + LATE_WRITE_GRACE_MS
			expect(gate.graceDeadline(fileA)).toBe(deadline)
			assertIncomplete()
			const stateUpdates = state.setSystemState.mock.calls.length
			await vi.advanceTimersByTimeAsync(1000)
			if (outcome === "late") {
				for (const point of oldPoints) points.set(point.id, point)
				held.resolve()
				await drain()
				expect(gate.graceDeadline(fileA)).toBe(deadline)
			}
			if (outcome === "late-reject" || outcome === "late-abort") {
				held.reject(
					outcome === "late-abort"
						? new DOMException("late cancellation rejection", "AbortError")
						: new Error("late old write rejection"),
				)
				await drain()
				const originalDeadline = deadline
				deadline = Date.now() + LATE_WRITE_GRACE_MS
				expect(deadline).toBe(originalDeadline + 1000)
				expect(gate.graceDeadline(fileA)).toBe(deadline)
				await vi.advanceTimersByTimeAsync(originalDeadline - Date.now())
				assertIncomplete()
				expect(verified).toEqual([{ at: expiryAt - 2, counts: { current: 1, other: 0 } }])
			}
			if (outcome === "cancel-grace") {
				await orchestrator.stopIndexing()
				await drain()
				expect(state.setSystemState).toHaveBeenLastCalledWith(
					"Standby",
					"embeddings:orchestrator.indexingStoppedPartial",
					"stop",
				)
				expect(hashes[fileA]).toBeUndefined()
				expect(open[fileA]).toBe(true)
				expect(retryFinished).not.toHaveBeenCalled()
				return
			}
			await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1)
			assertIncomplete()
			expect(state.setSystemState).toHaveBeenCalledTimes(stateUpdates)
			await vi.advanceTimersByTimeAsync(1)
			await drain()
			expect(Date.now()).toBe(deadline)
			expect(verified.at(-1)).toEqual({
				at: deadline,
				counts: { current: 1, other: outcome === "late" ? 1 : 0 },
			})
			expect(retryFinished).toHaveBeenCalledOnce()
			for (const pointId of currentIds) expect(points.has(pointId)).toBe(true)
			if (outcome === "late") {
				expect(hashes[fileA]).toBeUndefined()
				expect(open[fileA]).toBe(true)
				expect(state.setSystemState).toHaveBeenLastCalledWith(
					"Standby",
					"embeddings:orchestrator.indexingFilesFailed",
					"changed-file-batch",
				)
				expect(retryFinished.mock.calls[0][0].batchError).toBeInstanceOf(Error)
				expect(retryProgress.mock.calls.every(([value]) => value.processedInBatch === 0)).toBe(true)
			} else {
				expect(hashes[fileA]).toBe(hash("content a"))
				expect(state.state).toBe("Indexed")
				expect(retryProgress).toHaveBeenLastCalledWith({
					processedInBatch: completedFiles + 1,
					totalInBatch: completedFiles + 1,
					currentFile: fileA,
				})
				if (outcome === "unrelated") expect(hashes[fileB]).toBe(hash("content b"))
			}
		},
	)

	it("T34 explicit Start Indexing replaces a watcher provider wait through the real directory scanner", async () => {
		const filePath = path.join(workspace, "restart.md")
		vi.mocked(listFiles).mockResolvedValue([[filePath], false, []])
		vi.mocked(stat).mockResolvedValue({ size: 1000 } as any)
		vi.mocked(vscode.workspace.getWorkspaceFolder).mockReturnValue({ uri: { fsPath: workspace } } as any)
		const oldSource = "waiting revision ".repeat(10).trim()
		const newSource = "replacement revision ".repeat(10).trim()
		contents.set(filePath, oldSource)
		const request = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
			const body = JSON.parse(options!.body as string)
			return body.input[0] === oldSource
				? new Response(JSON.stringify({ error: "limited" }), { status: 429, headers: { "retry-after": "30" } })
				: new Response(JSON.stringify({ embeddings: [[1, 2, 3]] }))
		})
		vi.stubGlobal("fetch", request)
		embedder = new CodeIndexOllamaEmbedder({ ollamaBaseUrl: "https://embed.test", ollamaModelId: "custom" })
		parser = new CodeParser()
		const createServices = vi.fn()
		vi.doMock("../../service-factory", () => ({
			CodeIndexServiceFactory: vi.fn().mockImplementation(() => ({
				createServices,
				validateEmbedder: vi.fn().mockResolvedValue({ valid: true }),
			})),
		}))
		Object.assign(codeIndexLog, { redact: (value: string) => value })
		const { CodeIndexManager } = await import("../../manager")
		const { CodeIndexStateManager } = await import("../../state-manager")
		const manager = CodeIndexManager.getInstance(
			{
				workspaceState: { get: () => true },
				globalState: { get: () => true },
			} as any,
			workspace,
		)!
		const internal = manager as any
		const managerState = new CodeIndexStateManager()
		internal._stateManager = managerState
		internal._configManager = { isFeatureEnabled: true, isFeatureConfigured: true }
		internal._cacheManager = cache
		internal._searchService = {}
		internal.generationAllocator = generations
		gate = internal.writeGate
		pacers = manager.providerPacerRegistry
		watcher.dispose()
		watcher = makeWatcher()
		failures = manager.fileFailureRegistry
		// The manager must own the same registry used by both service generations.
		const makeManagedWatcher = () => {
			const created = new FileWatcher(
				workspace,
				{} as any,
				cache,
				embedder,
				store,
				ignore,
				1,
				parser,
				gate,
				generations,
				failures,
				undefined,
				pacers,
			)
			watchers.push(created)
			return created
		}
		watcher.dispose()
		watcher = makeManagedWatcher()
		const initialScan = {
			scanDirectory: vi.fn().mockResolvedValue({ stats: { processed: 0, skipped: 0 }, totalBlockCount: 0 }),
		}
		const initial = new CodeIndexOrchestrator(
			internal._configManager,
			managerState,
			workspace,
			cache,
			store,
			initialScan as any,
			watcher,
			undefined,
			undefined,
			undefined,
			gate,
			generations,
			() => internal.currentAttempt === 0,
			failures,
			pacers,
		)
		internal._orchestrator = initial
		try {
			await initial.startIndexing()
			await queue([filePath])
			expect(request).toHaveBeenCalledOnce()
			expect(failures.list()).toEqual([])
			const resumeAt = pacers.get(embedder.rateLimitScope).state().pausedUntil!
			expect(manager.getCurrentStatus().providerWaits).toEqual([
				expect.objectContaining({ waitingFiles: ["restart.md"], resumeAt }),
			])
			expect(initial.isScanning).toBe(false)
			expect(initial.isActive).toBe(true)
			contents.set(filePath, newSource)
			const replacementWatcher = makeManagedWatcher()
			const replacementScanner = new DirectoryScanner(
				embedder,
				store,
				parser,
				cache,
				ignore,
				1,
				gate,
				generations,
				failures,
				undefined,
				pacers,
			)
			const replacementScan = vi.spyOn(replacementScanner, "scanDirectory")
			createServices.mockReturnValue({
				embedder,
				vectorStore: store,
				scanner: replacementScanner,
				fileWatcher: replacementWatcher,
			})
			const startup = manager.startIndexing()
			expect(manager.startIndexing()).toBe(startup)
			await startup
			expect(request).toHaveBeenCalledOnce()
			expect(manager.state).toBe("Indexing")
			await vi.advanceTimersByTimeAsync(resumeAt - Date.now() - 1)
			expect(request).toHaveBeenCalledOnce()
			expect(cache.completeFile).not.toHaveBeenCalled()
			await vi.advanceTimersByTimeAsync(1)
			await vi.advanceTimersByTimeAsync(375)
			for (let advance = 0; advance < 20 && manager.state !== "Indexed"; advance++) {
				await vi.advanceTimersByTimeAsync(0)
			}
			expect(manager.state).toBe("Indexed")
			expect(createServices).toHaveBeenCalledOnce()
			expect(replacementScan).toHaveBeenCalledOnce()
			expect(listFiles).toHaveBeenCalledOnce()
			expect(stat).toHaveBeenCalledWith(filePath)
			expect(request).toHaveBeenCalledTimes(2)
			expect(JSON.parse(request.mock.calls[1][1]!.body as string).input).toEqual([newSource])
			expect(hashes[filePath]).toBe(hash(newSource))
			expect(cache.completeFile).toHaveBeenCalledExactlyOnceWith(filePath, hash(newSource))
			expect([...points.values()].map((point) => point.payload.codeChunk)).toEqual([newSource])
			expect(failures.list()).toEqual([])
			expect(manager.state).toBe("Indexed")
			const status = manager.getCurrentStatus()
			const savedPoints = [...points.entries()]
			const complete = vi.spyOn(managerState, "setSystemState")
			await vi.advanceTimersByTimeAsync(60_000)
			expect(request).toHaveBeenCalledTimes(2)
			expect([...points.entries()]).toEqual(savedPoints)
			expect(hashes[filePath]).toBe(hash(newSource))
			expect(cache.completeFile).toHaveBeenCalledOnce()
			expect(manager.getCurrentStatus()).toEqual(status)
			expect(complete).not.toHaveBeenCalled()
			complete.mockRestore()
		} finally {
			await manager.stopWatcher()
			CodeIndexManager.disposeAll()
			vi.doUnmock("../../service-factory")
			delete (codeIndexLog as any).redact
		}
	})

	it("T29 watcher submits whole Unicode characters and verifies the complete source hash", async () => {
		const filePath = path.join(workspace, "unicode.md")
		const source = "a".repeat(MAX_BLOCK_CHARS - 1) + "\u{1f600}" + "漢é".repeat(MAX_BLOCK_CHARS)
		contents.set(filePath, source)
		parser = new CodeParser()
		watcher.dispose()
		watcher = makeWatcher()
		await start()
		await queue([filePath])
		const submitted = embedder.createEmbeddings.mock.calls.flatMap(([texts]: [string[]]) => texts)
		expect(submitted.length).toBeGreaterThan(1)
		expect(submitted[0]).toHaveLength(MAX_BLOCK_CHARS - 1)
		for (const text of submitted) {
			expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)
			expect(Buffer.from(text).toString("utf8")).toBe(text)
		}
		expect(submitted.join("")).toBe(source)
		const stored = [...points.values()]
		expect(stored).toHaveLength(submitted.length)
		expect(store.countPointsForFile).toHaveBeenCalledWith(filePath, stored[0].payload.generation)
		expect(hashes[filePath]).toBe(hash(source))
		expect(open).toEqual({})
		expect(failures.list()).toEqual([])
		expect(state.state).toBe("Indexed")
	})

	it.each(["embed", "upsert"] as const)(
		"T30 watcher disable interrupts a 30s %s transport wait",
		async (activity) => {
			const request = vi.fn(async (input: RequestInfo | URL) => {
				const url = input instanceof Request ? input.url : String(input)
				if (url.endsWith("/")) return new Response(JSON.stringify({ title: "qdrant", version: "1.14.0" }))
				return new Response(JSON.stringify({ error: "limited" }), {
					status: 429,
					headers: { "content-type": "application/json", "retry-after": "30" },
				})
			})
			vi.stubGlobal("fetch", request)
			if (activity === "embed") embedder = new CodeIndexOllamaEmbedder({ ollamaBaseUrl: "https://embed.test" })
			else {
				const realStore = new QdrantVectorStore(workspace, "https://store.test", 3)
				store.upsertPoints.mockImplementation((batch: any[]) => realStore.upsertPoints(batch))
			}
			watcher.dispose()
			watcher = makeWatcher()
			await start()
			await queue()
			expect(failures.list()).toEqual([])
			expect(pacers.providerWaits()).toEqual([
				expect.objectContaining({ waitingFiles: ["a.ts"], resumeAt: Date.now() + 30_000 }),
			])
			expect(state.state).toBe("Indexing")
			const transportCalls = () =>
				request.mock.calls.filter(([input]) => {
					const url = input instanceof Request ? input.url : String(input)
					return activity === "embed" ? url.includes("/api/embed") : url.includes("/points")
				})
			expect(transportCalls()).toHaveLength(1)
			await vi.advanceTimersByTimeAsync(1000)
			expect(transportCalls()).toHaveLength(1)
			const stopped = orchestrator.stopWatcher()
			await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS)
			await stopped
			await queue([fileB])
			await vi.advanceTimersByTimeAsync(60_000)
			expect(transportCalls()).toHaveLength(1)
			expect(points.size).toBe(0)
			if (activity === "embed") expect(store.upsertPoints).not.toHaveBeenCalled()
			else expect(store.upsertPoints).toHaveBeenCalledOnce()
			expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
			expect(store.countPointsForFile).not.toHaveBeenCalled()
			expect(cache.completeFile).not.toHaveBeenCalled()
			expect(failures.list()).toEqual([])
			expect(state.setSystemState).toHaveBeenLastCalledWith(
				"Standby",
				"embeddings:orchestrator.indexingStoppedPartial",
				"stop",
			)
		},
	)

	it("T31 a newer watcher revision replaces a 30s provider wait without stale requests or completion", async () => {
		const filePath = path.join(workspace, "revision.md")
		const oldSource = "old revision ".repeat(10).trim()
		const newSource = "new revision ".repeat(10).trim()
		contents.set(filePath, oldSource)
		const request = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
			const body = JSON.parse(options!.body as string)
			return body.input[0] === oldSource
				? new Response(JSON.stringify({ error: "limited" }), { status: 429, headers: { "retry-after": "30" } })
				: new Response(JSON.stringify({ embeddings: [[1, 2, 3]] }))
		})
		vi.stubGlobal("fetch", request)
		embedder = new CodeIndexOllamaEmbedder({ ollamaBaseUrl: "https://embed.test", ollamaModelId: "custom" })
		parser = new CodeParser()
		watcher.dispose()
		watcher = makeWatcher()
		await start()
		await queue([filePath])
		expect(request).toHaveBeenCalledOnce()
		expect(failures.list()).toEqual([])
		const resumeAt = pacers.get(embedder.rateLimitScope).state().pausedUntil!
		expect(pacers.waitingPaths()).toEqual(["revision.md"])
		expect(state.state).toBe("Indexing")
		contents.set(filePath, newSource)
		await queue([filePath])
		await vi.advanceTimersByTimeAsync(500)
		await drain()
		expect(request).toHaveBeenCalledOnce()
		expect(hashes[filePath]).toBeUndefined()
		await vi.advanceTimersByTimeAsync(resumeAt - Date.now() - 1)
		expect(request).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(1)
		await drain()
		expect(request).toHaveBeenCalledTimes(2)
		expect(hashes[filePath]).toBe(hash(newSource))
		expect(cache.completeFile).toHaveBeenCalledExactlyOnceWith(filePath, hash(newSource))
		expect([...points.values()].map((point) => point.payload.codeChunk)).toEqual([newSource])
		expect(failures.list()).toEqual([])
		expect(state.state).toBe("Indexed")
		const savedPoints = [...points.entries()]
		const statusUpdates = state.setSystemState.mock.calls.length
		const progressUpdates = state.reportFileQueueProgress.mock.calls.length
		await vi.advanceTimersByTimeAsync(60_000)
		expect(request).toHaveBeenCalledTimes(2)
		expect(request.mock.calls.map(([, options]) => JSON.parse(options!.body as string).input)).toEqual([
			[oldSource],
			[newSource],
		])
		expect([...points.entries()]).toEqual(savedPoints)
		expect(hashes[filePath]).toBe(hash(newSource))
		expect(cache.completeFile).toHaveBeenCalledOnce()
		expect(state.setSystemState).toHaveBeenCalledTimes(statusUpdates)
		expect(state.reportFileQueueProgress).toHaveBeenCalledTimes(progressUpdates)
	})

	it("T22 real parser oversized single-line watcher segments have distinct verified IDs", async () => {
		const filePath = path.join(workspace, "long.md")
		contents.set(filePath, "abcdefghij".repeat(500))
		parser = new CodeParser()
		watcher.dispose()
		watcher = makeWatcher()
		await start()
		await queue([filePath])
		const stored = [...points.values()]
		expect(stored.length).toBeGreaterThan(1)
		expect(new Set(stored.map((point) => point.id)).size).toBe(stored.length)
		expect(new Set(stored.map((point) => point.payload.startLine)).size).toBe(1)
		expect(store.countPointsForFile).toHaveBeenCalledWith(filePath, stored[0].payload.generation)
		expect(hashes[filePath]).toBe(hash(contents.get(filePath)!))
		expect(state.state).toBe("Indexed")
	})

	it("tracks standalone processing and aborts it on dispose without initialize", async () => {
		const held = deferred<CodeBlock[]>()
		parser.parseFile.mockImplementation(() => held.promise)
		const pending = watcher.processFile(fileA).catch((error) => error)
		await drain()
		expect(watcher.isProcessing).toBe(true)
		watcher.dispose()
		held.resolve(blocks())
		expect((await pending).name).toBe("AbortError")
		expect(watcher.isProcessing).toBe(false)
		expect(embedder.createEmbeddings).not.toHaveBeenCalled()
	})
})
