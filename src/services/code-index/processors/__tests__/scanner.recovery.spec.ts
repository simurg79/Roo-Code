import "../../__tests__/mock-discovery"
import "../../__tests__/mock-code-index-log"
import * as path from "path"
import * as vscode from "vscode"
import { stat } from "fs/promises"
import { createHash } from "crypto"
import { EventEmitter } from "node:events"
import { DirectoryScanner } from "../scanner"
import { CodeIndexOrchestrator } from "../../orchestrator"
import { ParseWorkerClient, ParseRequest } from "../../parse-worker-client"
import { FileCompletion } from "../../file-completion"
import { CodeParser } from "../parser"
import { CacheManager } from "../../cache-manager"
import { GenerationAllocator } from "../../generation-allocator"
import { IndexWriteGate, LATE_WRITE_GRACE_MS } from "../../index-write-gate"
import { ParserFatalError } from "../../parser-errors"
import { CodeBlock } from "../../interfaces"
import { listFiles } from "../../../glob/list-files"
import { generateRelativeFilePath } from "../../shared/get-relative-path"
import {
	INDEX_STOP_LIMIT_MS,
	MAX_BLOCK_CHARS,
	MAX_FILE_SIZE_BYTES,
	PARSE_TIMEOUT_MS,
	PARSING_CONCURRENCY,
} from "../../constants"
import { CodeIndexOllamaEmbedder } from "../../embedders/ollama"
import { QdrantVectorStore } from "../../vector-store/qdrant-client"
import { FileFailureRegistry } from "../../file-failure-registry"
import { codeIndexLog } from "../../code-index-log"
import { ProviderPacerRegistry } from "../../provider-pacer"
import { definePacingContracts } from "./pacing-contracts"

vi.mock("../../../../i18n", () => ({ t: (key: string) => key }))

vi.mock("../../../../utils/path", () => ({ getWorkspacePathForContext: (directory: string) => directory }))

const storage = vi.hoisted(() => ({ snapshot: undefined as any, save: vi.fn() }))
vi.mock("../../../../utils/safeWriteJson", () => ({
	safeWriteJson: (...parameters: any[]) => storage.save(...parameters),
}))
vi.mock("fs/promises", () => ({ stat: vi.fn(), readFile: vi.fn() }))
vi.mock("vscode", () => ({
	workspace: {
		getWorkspaceFolder: vi.fn(),
		workspaceFolders: [{ uri: { fsPath: "scanner-recovery-workspace" } }],
		fs: { readFile: vi.fn() },
	},
	Uri: {
		file: (filePath: string) => ({ fsPath: filePath }),
		joinPath: (base: { fsPath: string }, suffix: string) => ({ fsPath: `${base.fsPath}/${suffix}` }),
	},
}))
vi.mock("../../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: class {
		async initialize() {}
		filterPaths(paths: string[]) {
			return paths
		}
	},
}))
vi.mock("../../../glob/list-files", () => ({ listFiles: vi.fn() }))

function deferred<Value>() {
	let resolve!: (value: Value) => void
	let reject!: (error: Error) => void
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

class ControlledScannerWorker extends EventEmitter {
	requests: ParseRequest[] = []
	postMessage(request: ParseRequest) {
		this.requests.push(request)
	}
	terminate = vi.fn().mockResolvedValue(1)
}

const workspacePath = path.resolve("scanner-recovery-workspace")
const fileA = path.join(workspacePath, "a.ts")
const fileB = path.join(workspacePath, "b.ts")
const contentHash = createHash("sha256").update("current content").digest("hex")
const context = { globalStorageUri: { fsPath: "cache" } } as vscode.ExtensionContext

function blocks(filePath: string, count = 1): CodeBlock[] {
	return Array.from({ length: count }, (_, blockNumber) => ({
		file_path: filePath,
		content: `function block${blockNumber}() { return ${blockNumber} }`,
		start_line: 1,
		end_line: 1,
		identifier: null,
		type: "function",
		fileHash: contentHash,
		segmentHash: `${filePath}:${blockNumber}`,
	}))
}

describe("DirectoryScanner durable per-file recovery", () => {
	let cache: CacheManager
	let gate: IndexWriteGate
	let generations: GenerationAllocator
	let points: Map<string, any>
	let store: any
	let embedder: any
	let parser: any
	let ignore: any
	let scanner: DirectoryScanner
	let listedPaths: string[]
	let failures: FileFailureRegistry
	let pacers: ProviderPacerRegistry

	const drain = () => vi.advanceTimersByTimeAsync(0)
	const createScanner = () =>
		new DirectoryScanner(embedder, store, parser, cache, ignore, 1, gate, generations, failures, undefined, pacers)
	const createOrchestrator = (isCurrent = () => true, sharedState?: any) => {
		const state = sharedState ?? {
			state: "Standby",
			setSystemState: vi.fn(function (this: { state: string }, next: string) {
				this.state = next
			}),
			reportBlockIndexingProgress: vi.fn(),
			reportFileQueueProgress: vi.fn(),
		}
		const watcher = {
			isProcessing: false,
			processFile: vi.fn(),
			initialize: vi.fn(),
			dispose: vi.fn(),
			onDidStartBatchProcessing: vi.fn(() => ({ dispose: vi.fn() })),
			onBatchProgressUpdate: vi.fn(() => ({ dispose: vi.fn() })),
			onDidFinishBatchProcessing: vi.fn(() => ({ dispose: vi.fn() })),
		}
		Object.assign(store, {
			initialize: vi.fn().mockResolvedValue(false),
			hasIndexedData: vi.fn().mockResolvedValue(false),
			markIndexingIncomplete: vi.fn(),
			markIndexingComplete: vi.fn(),
		})
		const fatal = vi.fn()
		const orchestrator = new CodeIndexOrchestrator(
			{ isFeatureConfigured: true } as any,
			state,
			workspacePath,
			cache,
			store,
			createScanner(),
			watcher,
			parser.stop ? parser : undefined,
			fatal,
			undefined,
			gate,
			generations,
			isCurrent,
			failures,
			pacers,
		)
		return { orchestrator, state, watcher, fatal }
	}
	const filePoints = (filePath: string) =>
		[...points.values()].filter(
			(point) => point.payload.filePath === generateRelativeFilePath(filePath, workspacePath),
		)
	const applyDelete = (filePath: string, beforeGeneration: number) => {
		for (const point of filePoints(filePath)) {
			if (point.payload.generation === undefined || point.payload.generation < beforeGeneration) {
				points.delete(point.id)
			}
		}
	}
	const seed = (filePath: string, generation = 0) => {
		const point = {
			id: `old:${filePath}:${generation}`,
			vector: [1],
			payload: { filePath: generateRelativeFilePath(filePath, workspacePath), generation },
		}
		points.set(point.id, point)
		return point
	}
	const reload = async () => {
		failures = new FileFailureRegistry()
		cache = new CacheManager(context, workspacePath)
		await cache.initialize()
		generations = new GenerationAllocator(cache)
		gate.recover(Object.keys(cache.getOpenFiles()), cache.loadedAt)
		scanner = createScanner()
	}

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-10-31T00:00:00Z"))
		storage.snapshot = undefined
		storage.save.mockReset().mockImplementation(async (_filePath: string, data: any) => {
			storage.snapshot = structuredClone(data)
		})
		vi.mocked(stat)
			.mockReset()
			.mockResolvedValue({ size: 100 } as any)
		vi.mocked(vscode.workspace.getWorkspaceFolder).mockReturnValue({ uri: { fsPath: workspacePath } } as any)
		vi.mocked(vscode.workspace.fs.readFile)
			.mockReset()
			.mockImplementation(async (uri) => {
				if (uri.fsPath.startsWith("cache/")) return Buffer.from(JSON.stringify(storage.snapshot))
				return Buffer.from("current content")
			})
		listedPaths = [fileA]
		vi.mocked(listFiles).mockImplementation(async () => [[...listedPaths], false])
		failures = new FileFailureRegistry()
		pacers = new ProviderPacerRegistry()
		cache = new CacheManager(context, workspacePath)
		gate = new IndexWriteGate()
		generations = new GenerationAllocator(cache)
		points = new Map()
		store = {
			rateLimitScope: "qdrant:scanner-test",
			upsertPoints: vi.fn().mockImplementation(async (newPoints: any[]) => {
				for (const point of newPoints) points.set(point.id, point)
			}),
			deletePointsByFilePath: vi.fn().mockImplementation(async (filePath: string, cutoff: number) => {
				applyDelete(filePath, cutoff)
			}),
			countPointsForFile: vi.fn().mockImplementation(async (filePath: string, generation: number) => {
				const stored = filePoints(filePath)
				return {
					current: stored.filter((point) => point.payload.generation === generation).length,
					other: stored.filter((point) => point.payload.generation !== generation).length,
				}
			}),
		}
		embedder = {
			rateLimitScope: "openai:scanner-test",
			createEmbeddings: vi
				.fn()
				.mockImplementation(async (texts: string[]) => ({ embeddings: texts.map(() => [1]) })),
		}
		parser = { parseFile: vi.fn().mockImplementation(async (filePath: string) => blocks(filePath)) }
		ignore = { ignores: vi.fn().mockReturnValue(false) }
		scanner = createScanner()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	definePacingContracts(() => {
		let pending: Promise<void>
		let scanState: any
		return {
			paths: [
				fileA,
				fileB,
				path.join(workspacePath, "c.ts"),
				...Array.from({ length: 197 }, (_, fileNumber) => path.join(workspacePath, `pacing-${fileNumber}.ts`)),
			],
			embedder,
			store,
			parser,
			pacers,
			failures,
			start: async (paths) => {
				listedPaths = paths
				const { orchestrator, state } = createOrchestrator()
				scanState = state
				pending = orchestrator.startIndexing()
				await drain()
			},
			finish: async () => {
				await pending
			},
			getStatus: () => ({ state: scanState.state, message: scanState.setSystemState.mock.calls.at(-1)?.[1] }),
			getHash: (filePath) => cache.getHash(filePath),
			getPoints: filePoints,
			seed,
		}
	}, vi)

	it("recovers a scan store request without reembedding and logs every retry plus its summary", async () => {
		store.upsertPoints.mockRejectedValueOnce(Object.assign(new Error("unavailable"), { status: 503 }))
		store.upsertPoints.mockRejectedValueOnce(Object.assign(new Error("unavailable"), { status: 503 }))
		const pending = scanner.scanDirectory(workspacePath)
		await vi.advanceTimersByTimeAsync(1500 + LATE_WRITE_GRACE_MS)
		expect((await pending).incompleteFiles).toEqual([])
		expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
		expect(store.upsertPoints).toHaveBeenCalledTimes(3)
		const batch = vi.mocked(codeIndexLog.createFailureBatch).mock.results.at(-1)!.value
		expect(batch.record.mock.calls.map(([failure]: any[]) => failure.attempt)).toEqual([1, 2])
		expect(batch.flush).toHaveBeenCalledOnce()
		expect(codeIndexLog.info).toHaveBeenCalledWith(
			"Scan summary",
			expect.objectContaining({
				processed: 1,
				skipped: 0,
				failed: 0,
				blocksFound: 1,
				blocksIndexed: 1,
				partialReason: undefined,
			}),
		)
	})

	it.each(["read", "parse", "fatal"])("records %s failures before ending the scan", async (activity) => {
		if (activity === "read") vi.mocked(stat).mockRejectedValueOnce(new Error("read failed"))
		else
			parser.parseFile.mockRejectedValueOnce(
				activity === "fatal" ? new ParserFatalError("parser-abort", fileA) : new Error("parse failed"),
			)
		const pending = scanner.scanDirectory(workspacePath, vi.fn())
		if (activity === "fatal") await expect(pending).rejects.toBeInstanceOf(ParserFatalError)
		else expect((await pending).incompleteFiles).toContain(fileA)
		expect(failures.list()).toEqual([
			expect.objectContaining({
				path: "a.ts",
				activity: activity === "read" ? "read" : "parse",
				attempt: 1,
				state: "exhausted",
				classification: "permanent",
			}),
		])
	})

	it("blocks unchanged exhausted files in later scans but renews only changed paths", async () => {
		parser.parseFile.mockRejectedValueOnce(new Error("parse failed"))
		await scanner.scanDirectory(workspacePath, vi.fn())
		await scanner.scanDirectory(workspacePath, vi.fn())
		expect(parser.parseFile).toHaveBeenCalledOnce()
		listedPaths = [fileA, fileB]
		await scanner.scanDirectory(workspacePath, vi.fn())
		expect(parser.parseFile.mock.calls.map(([filePath]: string[]) => filePath)).toEqual([fileA, fileB])
		expect(failures.isExhausted("a.ts", contentHash, "parse")).toBe(true)
	})

	it("removes a registry-only deleted source and retains failed removal until explicit retry", async () => {
		vi.mocked(stat).mockRejectedValueOnce(new Error("read failed"))
		await scanner.scanDirectory(workspacePath, vi.fn())
		expect(cache.getTrackedPaths()).toEqual([])
		listedPaths = []
		store.deletePointsByFilePath.mockRejectedValueOnce(new Error("delete failed"))
		await scanner.scanDirectory(workspacePath, vi.fn())
		await scanner.scanDirectory(workspacePath, vi.fn())
		expect(store.deletePointsByFilePath).toHaveBeenCalledOnce()
		expect(failures.list()[0]).toMatchObject({ activity: "delete", revision: "removed" })
		failures.resetAllBudgets()
		await scanner.scanDirectory(workspacePath)
		expect(failures.list()).toEqual([])
	})

	describe("T42 source missing at read is a removal", () => {
		const errorWithCode = (code: string) => Object.assign(new Error("gone"), { code })
		const failAt = (stage: "stat" | "read", error: Error) => {
			if (stage === "stat") vi.mocked(stat).mockRejectedValueOnce(error)
			else vi.mocked(vscode.workspace.fs.readFile).mockRejectedValueOnce(error)
		}

		it.each(
			(["stat", "read", "oversized"] as const).flatMap((source) =>
				(["new", "indexed", "failed"] as const).map((history) => ({ source, history })),
			),
		)("T42 preserves Decision 10 bookkeeping and logs for $history $source source", async ({ source, history }) => {
			listedPaths = [fileA, fileB]
			if (history === "indexed") cache.completeFile(fileA, contentHash)
			if (history !== "new") seed(fileA)
			if (history === "failed") {
				failures.renew("a.ts", "old")
				failures.record("a.ts", "old", "read", "read failed", 1, "exhausted")
			}
			vi.mocked(codeIndexLog.debug).mockClear()
			vi.mocked(codeIndexLog.warn).mockClear()
			if (source === "oversized")
				vi.mocked(stat).mockImplementation(
					async (filePath) =>
						({
							size: filePath === fileA ? MAX_FILE_SIZE_BYTES + 1 : 100,
						}) as any,
				)
			else failAt(source, errorWithCode(source === "stat" ? "ENOENT" : "FileNotFound"))
			const held = deferred<CodeBlock[]>()
			parser.parseFile.mockReturnValue(held.promise)
			const onError = vi.fn()
			const pending = scanner.scanDirectory(workspacePath, onError)
			await drain()
			try {
				expect(parser.parseFile).toHaveBeenCalledExactlyOnceWith(fileB, expect.anything())
				expect(scanner).toMatchObject({
					incompleteFiles: new Set(history === "new" ? [fileB] : [fileA, fileB]),
				})
				expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
				if (source === "oversized") expect(codeIndexLog.debug).not.toHaveBeenCalled()
				else
					expect(codeIndexLog.debug).toHaveBeenCalledExactlyOnceWith(
						"Source missing at read; treating as removed",
						{ path: "a.ts" },
					)
				expect(codeIndexLog.warn).not.toHaveBeenCalled()
				const batch = vi.mocked(codeIndexLog.createFailureBatch).mock.results.at(-1)!.value
				expect(batch.record).not.toHaveBeenCalled()
			} finally {
				held.resolve(blocks(fileB))
				await pending
			}
			const result = await pending
			expect(result.stats).toEqual({ processed: 1, skipped: source === "oversized" ? 1 : 0 })
			expect(result.incompleteFiles).toEqual([])
			expect(scanner.hasIncompleteFiles).toBe(false)
			expect(filePoints(fileA)).toEqual([])
			expect(cache.getHash(fileA)).toBeUndefined()
			expect(cache.getHash(fileB)).toBe(contentHash)
			expect(onError).not.toHaveBeenCalled()
			expect(failures.list()).toEqual([])
			if (history === "new")
				expect(store.deletePointsByFilePath).not.toHaveBeenCalledWith(fileA, expect.anything())
			else expect(store.deletePointsByFilePath).toHaveBeenCalledWith(fileA, expect.any(Number))
		})

		it.each([
			["stat", "ENOENT"],
			["read", "FileNotFound"],
		] as const)("never-indexed file missing at %s needs no recovery", async (stage, code) => {
			listedPaths = [fileA, fileB]
			failAt(stage, errorWithCode(code))
			const onError = vi.fn()
			const result = await scanner.scanDirectory(workspacePath, onError)
			expect(result.incompleteFiles).toEqual([])
			expect(result.stats).toEqual({ processed: 1, skipped: 0 })
			expect(cache.getHash(fileB)).toBe(contentHash)
			expect(onError).not.toHaveBeenCalled()
			expect(store.deletePointsByFilePath).not.toHaveBeenCalledWith(fileA, expect.anything())
			expect(failures.list()).toEqual([])
		})

		it.each(["stat", "read"] as const)(
			"previously indexed file missing at %s is removed in the same scan",
			async (stage) => {
				await scanner.scanDirectory(workspacePath)
				expect(filePoints(fileA)).toHaveLength(1)
				failAt(stage, errorWithCode(stage === "stat" ? "ENOENT" : "FileNotFound"))
				const onError = vi.fn()
				const result = await scanner.scanDirectory(workspacePath, onError)
				expect(result.incompleteFiles).toEqual([])
				expect(filePoints(fileA)).toEqual([])
				expect(cache.getHash(fileA)).toBeUndefined()
				expect(onError).not.toHaveBeenCalled()
				expect(failures.list()).toEqual([])
			},
		)

		it.each(
			(["stat", "read"] as const).flatMap((stage) =>
				(["new", "indexed", "failed"] as const).flatMap((history) =>
					(["during", "after"] as const).map((timing) => ({ stage, history, timing })),
				),
			),
		)(
			"removes $history source missing at $stage $timing a concurrent provider wait",
			async ({ stage, history, timing }) => {
				if (history === "indexed") await scanner.scanDirectory(workspacePath)
				if (history === "failed") {
					seed(fileA)
					failures.renew("a.ts", "old")
					failures.record("a.ts", "old", "read", "read failed", 1, "exhausted")
				}
				listedPaths = [fileA, fileB]
				const metadata = deferred<any>()
				vi.mocked(stat).mockImplementation(async (filePath) =>
					filePath === fileA ? metadata.promise : ({ size: 100 } as any),
				)
				const readFile = vi.mocked(vscode.workspace.fs.readFile).getMockImplementation()!
				const missingRead = vi.fn()
				vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) => {
					if (uri.fsPath === fileA) {
						missingRead()
						throw errorWithCode("FileNotFound")
					}
					return readFile(uri)
				})
				embedder.createEmbeddings
					.mockClear()
					.mockRejectedValueOnce(Object.assign(new Error("limited"), { status: 429, retryAfterMs: 30_000 }))
				const onError = vi.fn()
				const pending = scanner.scanDirectory(workspacePath, onError)
				await drain()
				expect(pacers.waitingPaths()).toContain("b.ts")
				expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
				expect(missingRead).not.toHaveBeenCalled()
				await vi.advanceTimersByTimeAsync(timing === "during" ? 29_999 : 30_000)
				if (stage === "stat") metadata.reject(errorWithCode("ENOENT"))
				else metadata.resolve({ size: 100 })
				await drain()
				expect(missingRead).toHaveBeenCalledTimes(stage === "read" ? 1 : 0)
				if (timing === "during") {
					expect(pacers.waitingPaths()).toContain("b.ts")
					expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
					await vi.advanceTimersByTimeAsync(1)
				}
				const result = await pending
				expect(result.stats).toEqual({ processed: 1, skipped: 0 })
				expect(result.incompleteFiles).toEqual([])
				expect(scanner.hasIncompleteFiles).toBe(false)
				expect(filePoints(fileA)).toEqual([])
				expect(cache.getHash(fileA)).toBeUndefined()
				expect(filePoints(fileB)).toHaveLength(1)
				expect(cache.getHash(fileB)).toBe(contentHash)
				expect(onError).not.toHaveBeenCalled()
				expect(failures.list()).toEqual([])
				expect(pacers.waitingPaths()).toEqual([])
				if (history === "new")
					expect(store.deletePointsByFilePath).not.toHaveBeenCalledWith(fileA, expect.anything())
				else expect(store.deletePointsByFilePath).toHaveBeenCalledWith(fileA, expect.any(Number))
			},
		)

		it("clears a prior failure for a path found missing", async () => {
			parser.parseFile.mockRejectedValueOnce(new Error("parse failed"))
			await scanner.scanDirectory(workspacePath, vi.fn())
			expect(failures.list()).toHaveLength(1)
			failAt("read", errorWithCode("FileNotFound"))
			const result = await scanner.scanDirectory(workspacePath, vi.fn())
			expect(result.incompleteFiles).toEqual([])
			expect(failures.list()).toEqual([])
		})

		it("keeps a cleanup failure as a delete failure, not a read failure", async () => {
			await scanner.scanDirectory(workspacePath)
			failAt("stat", errorWithCode("ENOENT"))
			store.deletePointsByFilePath.mockRejectedValueOnce(new Error("delete failed"))
			const result = await scanner.scanDirectory(workspacePath, vi.fn())
			expect(result.incompleteFiles).toEqual([fileA])
			expect(failures.list()).toEqual([expect.objectContaining({ path: "a.ts", activity: "delete" })])
		})

		it.each([
			["stat", "EACCES"],
			["read", "NoPermissions"],
			["read", "EISDIR"],
		] as const)("keeps denied access at %s (%s) as a read failure", async (stage, code) => {
			failAt(stage, errorWithCode(code))
			const onError = vi.fn()
			const result = await scanner.scanDirectory(workspacePath, onError)
			expect(result.incompleteFiles).toEqual([fileA])
			expect(onError).toHaveBeenCalledOnce()
			expect(failures.list()).toEqual([
				expect.objectContaining({ path: "a.ts", activity: "read", state: "exhausted" }),
			])
		})

		it("indexes a recreated file normally on the next scan", async () => {
			await scanner.scanDirectory(workspacePath)
			failAt("read", errorWithCode("FileNotFound"))
			await scanner.scanDirectory(workspacePath)
			expect(filePoints(fileA)).toEqual([])
			await scanner.scanDirectory(workspacePath)
			expect(filePoints(fileA)).toHaveLength(1)
			expect(cache.getHash(fileA)).toBe(contentHash)
		})
	})

	it.each(["cancel", "disable", "fatal"])("T5 preserves completed A while B is in flight on %s", async (stop) => {
		listedPaths = [fileA, fileB]
		const held = deferred<CodeBlock[]>()
		parser.parseFile.mockImplementation(async (filePath: string) =>
			filePath === fileB ? held.promise : blocks(filePath),
		)
		const controller = new AbortController()
		const progress = vi.fn()
		const pending = scanner
			.scanDirectory(workspacePath, undefined, progress, undefined, controller.signal)
			.catch((error) => error)
		await drain()
		expect(cache.getHash(fileA)).toBe(contentHash)
		expect(cache.getHash(fileB)).toBeUndefined()
		expect(progress).toHaveBeenCalledExactlyOnceWith(1)
		expect(scanner.hasIncompleteFiles).toBe(true)
		if (stop === "fatal") held.reject(new ParserFatalError("parser-abort", fileB))
		else {
			controller.abort()
			held.resolve(blocks(fileB))
		}
		await pending
		parser.parseFile.mockImplementation(async (filePath: string) => blocks(filePath))
		embedder.createEmbeddings.mockClear()
		failures.resetAllBudgets()
		await scanner.scanDirectory(workspacePath)
		expect(embedder.createEmbeddings).toHaveBeenCalledTimes(1)
		expect(scanner.hasIncompleteFiles).toBe(false)
	})

	it("marks discovered, queued and pre-invalidation files incomplete", async () => {
		listedPaths = Array.from({ length: PARSING_CONCURRENCY + 2 }, (_, fileNumber) =>
			path.join(workspacePath, `${fileNumber}.ts`),
		)
		const held = deferred<CodeBlock[]>()
		parser.parseFile.mockReturnValue(held.promise)
		const controller = new AbortController()
		const pending = scanner
			.scanDirectory(workspacePath, undefined, undefined, undefined, controller.signal)
			.catch((error) => error)
		await drain()
		expect(parser.parseFile).toHaveBeenCalledTimes(PARSING_CONCURRENCY)
		expect(scanner.hasIncompleteFiles).toBe(true)
		expect(storage.snapshot).toBeUndefined()
		controller.abort()
		held.resolve([])
		expect(await pending).toMatchObject({ name: "AbortError" })
		expect(scanner.hasIncompleteFiles).toBe(true)
		expect(parser.parseFile).toHaveBeenCalledTimes(PARSING_CONCURRENCY)
	})

	it("fatal parsing immediately stops queued dispatch without waiting for running files", async () => {
		listedPaths = Array.from({ length: PARSING_CONCURRENCY + 2 }, (_, fileNumber) =>
			path.join(workspacePath, `${fileNumber}.ts`),
		)
		const held = deferred<CodeBlock[]>()
		const fatal = new ParserFatalError("parse-timeout", listedPaths[0])
		parser.parseFile.mockImplementation(async (filePath: string) => {
			if (filePath === listedPaths[0]) throw fatal
			return held.promise
		})
		const pending = scanner.scanDirectory(workspacePath).catch((error) => error)
		await drain()
		expect(await pending).toBe(fatal)
		held.resolve([])
		await drain()
		expect(parser.parseFile).toHaveBeenCalledTimes(PARSING_CONCURRENCY)
		expect(store.upsertPoints).not.toHaveBeenCalled()
	})

	it.each(["success", "failure", "abort"])("T6/T18 final batch gates completion: %s", async (outcome) => {
		parser.parseFile.mockResolvedValue(blocks(fileA, 3))
		const held = deferred<{ embeddings: number[][] }>()
		embedder.createEmbeddings
			.mockImplementationOnce(async () => ({ embeddings: [[1]] }))
			.mockReturnValueOnce(held.promise)
		const controller = new AbortController()
		const progress = vi.fn()
		const pending = scanner
			.scanDirectory(workspacePath, vi.fn(), progress, undefined, controller.signal)
			.catch((error) => error)
		await drain()
		expect(store.upsertPoints).toHaveBeenCalledTimes(1)
		expect(cache.getHash(fileA)).toBeUndefined()
		expect(progress).not.toHaveBeenCalled()
		expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
		if (outcome === "failure") held.reject(new Error("embedding failed"))
		else {
			if (outcome === "abort") controller.abort()
			held.resolve({ embeddings: [[1]] })
		}
		await pending
		if (outcome === "success") {
			expect(cache.getHash(fileA)).toBe(contentHash)
			expect(progress).toHaveBeenCalledExactlyOnceWith(3)
		} else {
			expect(cache.getHash(fileA)).toBeUndefined()
			expect(cache.getOpenFiles()[fileA]).toBe(true)
			failures.resetAllBudgets()
			await scanner.scanDirectory(workspacePath)
			expect(filePoints(fileA)).toHaveLength(3)
			expect(cache.getHash(fileA)).toBe(contentHash)
		}
	})

	it.each(["replacement", "removal", "exclusion"])(
		"T17 awaits durable invalidation before %s; failed save issues no mutation",
		async (operation) => {
			cache.completeFile(fileA, "previous hash")
			seed(fileA)
			if (operation === "removal") listedPaths = []
			if (operation === "exclusion") ignore.ignores.mockReturnValue(true)
			const held = deferred<void>()
			const save = storage.save.getMockImplementation()!
			storage.save.mockImplementation(async (filePath: string, data: any) => {
				await save(filePath, data)
				if (data.openFiles[generateRelativeFilePath(fileA, workspacePath)]) await held.promise
			})
			const pending = scanner.scanDirectory(workspacePath, vi.fn())
			await drain()
			expect(storage.snapshot.fileHashes[generateRelativeFilePath(fileA, workspacePath)]).toBeUndefined()
			expect(storage.snapshot.openFiles[generateRelativeFilePath(fileA, workspacePath)]).toBe(true)
			expect(store.upsertPoints).not.toHaveBeenCalled()
			expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
			held.reject(new Error("disk full"))
			const result = await pending
			expect(result.incompleteFiles).toEqual([fileA])
			expect(store.upsertPoints).not.toHaveBeenCalled()
			expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
		},
	)

	it("T11 failed cleanup reloads open without hash; retry restores complete content", async () => {
		seed(fileA)
		store.deletePointsByFilePath.mockRejectedValueOnce(new Error("delete failed"))
		const result = await scanner.scanDirectory(workspacePath, vi.fn())
		expect(result.incompleteFiles).toEqual([fileA])
		await reload()
		expect(cache.getHash(fileA)).toBeUndefined()
		expect(cache.getOpenFiles()[fileA]).toBe(true)
		const pending = scanner.scanDirectory(workspacePath)
		await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS)
		await pending
		expect(filePoints(fileA)).toHaveLength(1)
		expect(cache.getHash(fileA)).toBe(contentHash)
		expect(cache.getOpenFiles()).toEqual({})
	})

	it.each(["deleted", "excluded", "oversized"])(
		"T20/T21 removes an interrupted open file when %s",
		async (selection) => {
			parser.parseFile.mockResolvedValue(blocks(fileA, 3))
			const held = deferred<{ embeddings: number[][] }>()
			embedder.createEmbeddings.mockResolvedValueOnce({ embeddings: [[1]] }).mockReturnValueOnce(held.promise)
			const controller = new AbortController()
			const interrupted = scanner
				.scanDirectory(workspacePath, undefined, undefined, undefined, controller.signal)
				.catch((error) => error)
			await drain()
			expect(filePoints(fileA)).toHaveLength(1)
			controller.abort()
			held.resolve({ embeddings: [[1]] })
			await interrupted
			await reload()
			if (selection === "deleted") listedPaths = []
			if (selection === "excluded") ignore.ignores.mockReturnValue(true)
			if (selection === "oversized") vi.mocked(stat).mockResolvedValue({ size: 2 * 1024 * 1024 } as any)
			store.deletePointsByFilePath.mockRejectedValueOnce(new Error("delete failed"))
			const failed = await scanner.scanDirectory(workspacePath, vi.fn())
			expect(failed.incompleteFiles).toEqual([fileA])
			expect(cache.getOpenFiles()[fileA]).toBe(true)
			failures.resetAllBudgets()
			const result = await scanner.scanDirectory(workspacePath)
			expect(result.incompleteFiles).toEqual([])
			expect(filePoints(fileA)).toEqual([])
			expect(cache.getTrackedPaths()).toEqual([])
			expect(store.deletePointsByFilePath).toHaveBeenCalledWith(fileA, expect.any(Number))
		},
	)

	it.each(["deleted", "excluded"])(
		"T20/T21 lost completed-file removal result forces identical-content replacement: %s",
		async (selection) => {
			await scanner.scanDirectory(workspacePath)
			if (selection === "deleted") listedPaths = []
			else ignore.ignores.mockReturnValue(true)
			const held = deferred<void>()
			store.deletePointsByFilePath.mockImplementationOnce(async (filePath: string, cutoff: number) => {
				applyDelete(filePath, cutoff)
				await held.promise
			})
			const controller = new AbortController()
			const removal = scanner
				.scanDirectory(workspacePath, undefined, undefined, undefined, controller.signal)
				.catch((error) => error)
			await drain()
			expect(filePoints(fileA)).toEqual([])
			expect(storage.snapshot.fileHashes[generateRelativeFilePath(fileA, workspacePath)]).toBeUndefined()
			expect(storage.snapshot.openFiles[generateRelativeFilePath(fileA, workspacePath)]).toBe(true)
			controller.abort()
			await reload()
			listedPaths = [fileA]
			ignore.ignores.mockReturnValue(false)
			store.countPointsForFile.mockClear()
			const retry = scanner.scanDirectory(workspacePath)
			await drain()
			expect(store.countPointsForFile).toHaveBeenCalledOnce()
			expect(cache.getHash(fileA)).toBeUndefined()
			expect(cache.getOpenFiles()[fileA]).toBe(true)
			await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS - 1)
			expect(cache.getHash(fileA)).toBeUndefined()
			await vi.advanceTimersByTimeAsync(1)
			const deadline = Date.now() + LATE_WRITE_GRACE_MS
			expect(gate.graceDeadline(fileA)).toBe(deadline)
			await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS - 1)
			expect(cache.getHash(fileA)).toBeUndefined()
			expect(cache.getOpenFiles()[fileA]).toBe(true)
			expect(store.countPointsForFile).toHaveBeenCalledOnce()
			await vi.advanceTimersByTimeAsync(1)
			await retry
			expect(Date.now()).toBe(deadline)
			expect(store.countPointsForFile).toHaveBeenCalledTimes(2)
			expect(cache.getHash(fileA)).toBe(contentHash)
			expect(filePoints(fileA)).toHaveLength(1)
			expect(cache.getOpenFiles()).toEqual({})
			expect(store.countPointsForFile).toHaveBeenLastCalledWith(fileA, filePoints(fileA)[0].payload.generation)
			held.resolve()
			await removal
			expect(cache.getHash(fileA)).toBe(contentHash)
		},
	)

	it.each(["cleanup", "removal", "exclusion"])(
		"T10/T20/T21 delayed old %s cannot delete a verified retry",
		async (operation) => {
			if (operation !== "cleanup") {
				await scanner.scanDirectory(workspacePath)
				if (operation === "removal") listedPaths = []
				else ignore.ignores.mockReturnValue(true)
			}
			const held = deferred<void>()
			store.deletePointsByFilePath.mockImplementationOnce(async (filePath: string, cutoff: number) => {
				await held.promise
				applyDelete(filePath, cutoff)
			})
			const controller = new AbortController()
			const old = scanner
				.scanDirectory(workspacePath, undefined, undefined, undefined, controller.signal)
				.catch((error) => error)
			await drain()
			controller.abort()
			gate.abandon(controller.signal)
			listedPaths = [fileA]
			ignore.ignores.mockReturnValue(false)
			const retry = createScanner().scanDirectory(workspacePath)
			await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS + INDEX_STOP_LIMIT_MS)
			await retry
			const currentIds = filePoints(fileA).map((point) => point.id)
			expect(cache.getHash(fileA)).toBe(contentHash)
			held.resolve()
			await old
			expect(filePoints(fileA).map((point) => point.id)).toEqual(currentIds)
		},
	)

	it.each([
		{ current: 0, other: 0 },
		{ current: 1, other: 1 },
	])("T10 verification refuses mismatched counts %o", async (counts) => {
		store.countPointsForFile.mockResolvedValue(counts)
		const result = await scanner.scanDirectory(workspacePath, vi.fn())
		expect(result.incompleteFiles).toEqual([fileA])
		expect(cache.getHash(fileA)).toBeUndefined()
	})

	it.each(["none", "inside", "after", "cancel"])("T12/T24 uncertain old upsert arrival: %s", async (arrival) => {
		let delayedPoints: any[] = []
		store.upsertPoints.mockImplementationOnce(async (newPoints: any[]) => {
			delayedPoints = newPoints
			throw new Error("local timeout")
		})
		await scanner.scanDirectory(workspacePath, vi.fn())
		const progress = vi.fn()
		const controller = new AbortController()
		let finished = false
		failures.resetAllBudgets()
		const retry = scanner
			.scanDirectory(workspacePath, vi.fn(), progress, undefined, controller.signal)
			.then((result) => {
				finished = true
				return result
			})
			.catch((error) => error)
		await drain()
		const currentIds = filePoints(fileA).map((point) => point.id)
		expect(currentIds).toHaveLength(1)
		expect(cache.getHash(fileA)).toBeUndefined()
		expect(cache.getOpenFiles()[fileA]).toBe(true)
		expect(progress).not.toHaveBeenCalled()
		expect(finished).toBe(false)
		if (arrival === "inside") for (const point of delayedPoints) points.set(point.id, point)
		if (arrival === "cancel") controller.abort()
		await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS - 1)
		if (arrival !== "cancel") expect(finished).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		const result = await retry
		if (arrival === "cancel") {
			expect(result).toMatchObject({ name: "AbortError" })
			expect(scanner.hasIncompleteFiles).toBe(true)
			expect(cache.getHash(fileA)).toBeUndefined()
		} else if (arrival === "inside") {
			expect(result.incompleteFiles).toEqual([fileA])
			expect(cache.getHash(fileA)).toBeUndefined()
			for (const pointId of currentIds) expect(points.has(pointId)).toBe(true)
			failures.resetAllBudgets()
			await scanner.scanDirectory(workspacePath)
			expect(filePoints(fileA)).toHaveLength(1)
		} else {
			expect(cache.getHash(fileA)).toBe(contentHash)
			expect(progress).toHaveBeenCalledExactlyOnceWith(1)
			if (arrival === "after") {
				listedPaths = [fileB]
				// Keep A selected so only an explicit re-index removes its late extras.
				listedPaths.push(fileA)
				await scanner.scanDirectory(workspacePath)
				const otherIds = filePoints(fileB).map((point) => point.id)
				for (const point of delayedPoints) points.set(point.id, point)
				for (const pointId of currentIds) expect(points.has(pointId)).toBe(true)
				expect(filePoints(fileA)).toHaveLength(2)
				expect(filePoints(fileB).map((point) => point.id)).toEqual(otherIds)
				await cache.invalidateFile(fileA)
				await scanner.scanDirectory(workspacePath)
				expect(filePoints(fileA)).toHaveLength(1)
				expect(filePoints(fileB).map((point) => point.id)).toEqual(otherIds)
			}
		}
	})

	it("T12 a second uncertainty extends the grace deadline", async () => {
		gate.recover([fileA])
		const pending = scanner.scanDirectory(workspacePath)
		await vi.advanceTimersByTimeAsync(10_000)
		gate.recover([fileA])
		await vi.advanceTimersByTimeAsync(20_000)
		expect(cache.getHash(fileA)).toBeUndefined()
		await vi.advanceTimersByTimeAsync(10_000)
		await pending
		expect(cache.getHash(fileA)).toBe(contentHash)
	})

	it("keeps oversized tracked files incomplete while unrelated parsing is in flight", async () => {
		listedPaths = [fileA, fileB]
		cache.completeFile(fileA, contentHash)
		seed(fileA)
		vi.mocked(stat).mockImplementation(
			async (filePath) =>
				({
					size: filePath === fileA ? 2 * 1024 * 1024 : 100,
				}) as any,
		)
		const held = deferred<CodeBlock[]>()
		parser.parseFile.mockReturnValue(held.promise)
		const controller = new AbortController()
		const pending = scanner
			.scanDirectory(workspacePath, undefined, undefined, undefined, controller.signal)
			.catch((error) => error)
		await drain()
		expect(scanner.hasIncompleteFiles).toBe(true)
		expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
		controller.abort()
		held.resolve([])
		await pending
		expect(scanner.hasIncompleteFiles).toBe(true)
	})

	it("T11 partial upsert survives reload as open and is fully replaced", async () => {
		parser.parseFile.mockResolvedValue(blocks(fileA, 3))
		const held = deferred<{ embeddings: number[][] }>()
		embedder.createEmbeddings
			.mockImplementationOnce(async () => ({ embeddings: [[1]] }))
			.mockReturnValueOnce(held.promise)
		const controller = new AbortController()
		const interrupted = scanner
			.scanDirectory(workspacePath, undefined, undefined, undefined, controller.signal)
			.catch((error) => error)
		await drain()
		expect(filePoints(fileA)).toHaveLength(1)
		controller.abort()
		held.resolve({ embeddings: [[1]] })
		await interrupted
		await reload()
		expect(cache.getHash(fileA)).toBeUndefined()
		expect(cache.getOpenFiles()[fileA]).toBe(true)
		parser.parseFile.mockResolvedValue(blocks(fileA, 2))
		const retry = scanner.scanDirectory(workspacePath)
		await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS)
		await retry
		expect(filePoints(fileA)).toHaveLength(2)
		expect(cache.getHash(fileA)).toBe(contentHash)
		expect(cache.getOpenFiles()).toEqual({})
	})

	it("T6 refuses queued writes after abort and retries without hashing partial content", async () => {
		parser.parseFile.mockResolvedValue(blocks(fileA, 3))
		const controller = new AbortController()
		const upsert = store.upsertPoints.getMockImplementation()!
		store.upsertPoints.mockImplementationOnce(async (newPoints: any[]) => {
			await upsert(newPoints)
			controller.abort()
		})
		const result = await scanner
			.scanDirectory(workspacePath, undefined, undefined, undefined, controller.signal)
			.catch((error) => error)
		expect(result).toMatchObject({ name: "AbortError" })
		expect(store.upsertPoints).toHaveBeenCalledTimes(1)
		expect(embedder.createEmbeddings).toHaveBeenCalledTimes(1)
		expect(cache.getHash(fileA)).toBeUndefined()
		const retry = scanner.scanDirectory(workspacePath)
		await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS)
		await retry
		expect(filePoints(fileA)).toHaveLength(3)
		expect(cache.getHash(fileA)).toBe(contentHash)
	})

	it("T5 completion does not wait for an unrelated embedding request", async () => {
		listedPaths = [fileA, fileB]
		const held = deferred<{ embeddings: number[][] }>()
		embedder.createEmbeddings.mockImplementation(async (texts: string[]) => {
			return texts[0].includes("held") ? held.promise : { embeddings: [[1]] }
		})
		parser.parseFile.mockImplementation(async (filePath: string) => {
			const selected = blocks(filePath)
			if (filePath === fileB) selected[0].content = "held embedding"
			return selected
		})
		const controller = new AbortController()
		const progress = vi.fn()
		const pending = scanner
			.scanDirectory(workspacePath, undefined, progress, undefined, controller.signal)
			.catch((error) => error)
		await drain()
		expect(cache.getHash(fileA)).toBe(contentHash)
		expect(cache.getHash(fileB)).toBeUndefined()
		expect(progress).toHaveBeenCalledExactlyOnceWith(1)
		controller.abort()
		held.resolve({ embeddings: [[1]] })
		await pending
		expect(filePoints(fileB)).toEqual([])
	})

	it("T2 real scanner/client timeout reaches orchestrator Error without blocking a scheduled probe", async () => {
		listedPaths = [fileA, fileB]
		const worker = new ControlledScannerWorker()
		parser = new ParseWorkerClient(() => worker)
		const { orchestrator, state, fatal, watcher } = createOrchestrator()
		const pending = orchestrator.startIndexing()
		await drain()
		expect(worker.requests.map((request) => request.filePath)).toEqual([fileA])
		const probe = vi.fn()
		setTimeout(probe, 100)
		await vi.advanceTimersByTimeAsync(100)
		expect(probe).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(PARSE_TIMEOUT_MS - 101)
		expect(state.state).toBe("Indexing")
		await vi.advanceTimersByTimeAsync(1)
		await pending
		expect(fatal).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ filePath: fileA, category: "parse-timeout" }),
			"embeddings:orchestrator.parserFailed",
		)
		expect(state.state).toBe("Error")
		expect(worker.terminate).toHaveBeenCalledOnce()
		expect(worker.requests).toHaveLength(1)
		expect(watcher.initialize).not.toHaveBeenCalled()
		expect(store.upsertPoints).not.toHaveBeenCalled()
		worker.emit("exit", 1)
		await orchestrator.stopIndexing()
	})

	it.each(["cancel", "disable"])("T3 real scanner/client hang %s is shared and bounded", async (action) => {
		listedPaths = [fileA, fileB]
		const worker = new ControlledScannerWorker()
		const client = new ParseWorkerClient(() => worker)
		parser = client
		const { orchestrator, state, watcher, fatal } = createOrchestrator()
		const pending = orchestrator.startIndexing()
		await drain()
		expect(worker.requests).toHaveLength(1)
		const stopped = action === "cancel" ? orchestrator.stopIndexing() : orchestrator.stopWatcher()
		expect(orchestrator.stopIndexing()).toBe(stopped)
		expect(orchestrator.stopWatcher()).toBe(stopped)
		expect(state.state).toBe("Stopping")
		await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS - 1)
		expect(state.state).toBe("Stopping")
		await vi.advanceTimersByTimeAsync(1)
		await stopped
		await pending
		expect(state.setSystemState).toHaveBeenLastCalledWith(
			"Standby",
			"embeddings:orchestrator.indexingStoppedPartial",
			"stop",
		)
		worker.emit("message", { id: worker.requests[0].id, blocks: blocks(fileA) })
		await orchestrator.startIndexing()
		await expect(client.parseFile(fileB)).rejects.toMatchObject({ name: "AbortError" })
		expect(worker.requests).toHaveLength(1)
		expect(worker.terminate).toHaveBeenCalledOnce()
		expect(watcher.initialize).not.toHaveBeenCalled()
		expect(watcher.dispose).toHaveBeenCalledOnce()
		expect(fatal).not.toHaveBeenCalled()
		expect(embedder.createEmbeddings).not.toHaveBeenCalled()
		worker.emit("exit", 1)
		await client.stopped
	})

	it.each(["failure", "cancellation-error"])(
		"T9 scanner discards late embedding %s after bounded stop",
		async (outcome) => {
			parser.parseFile.mockResolvedValue(blocks(fileA, 3))
			const held = deferred<{ embeddings: number[][] }>()
			embedder.createEmbeddings.mockReturnValueOnce(held.promise)
			const { orchestrator, state } = createOrchestrator()
			const pending = orchestrator.startIndexing()
			await drain()
			expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
			const signal = embedder.createEmbeddings.mock.calls[0][2] as AbortSignal
			const stopped = orchestrator.stopIndexing()
			expect(signal.aborted).toBe(true)
			await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS)
			await stopped
			const updates = state.setSystemState.mock.calls.length
			const progressUpdates = state.reportBlockIndexingProgress.mock.calls.length
			held.reject(
				outcome === "failure"
					? new Error("late provider failure")
					: new DOMException("cancelled", "AbortError"),
			)
			await pending
			expect(state.setSystemState).toHaveBeenCalledTimes(updates)
			expect(state.reportBlockIndexingProgress).toHaveBeenCalledTimes(progressUpdates)
			expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
			expect(store.upsertPoints).not.toHaveBeenCalled()
			expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
			expect(cache.getHash(fileA)).toBeUndefined()
			expect(cache.getOpenFiles()[fileA]).toBe(true)
		},
	)

	it("T12 late old upsert before initial verification refuses completion and preserves current IDs", async () => {
		let delayedPoints: any[] = []
		store.upsertPoints.mockImplementationOnce(async (newPoints: any[]) => {
			delayedPoints = newPoints
			throw new Error("local timeout")
		})
		await scanner.scanDirectory(workspacePath, vi.fn())
		const rejectedAt = Date.now()
		expect(gate.graceDeadline(fileA)).toBe(rejectedAt + LATE_WRITE_GRACE_MS)
		const count = store.countPointsForFile.getMockImplementation()!
		let currentIds: string[] = []
		store.countPointsForFile.mockImplementationOnce(async (filePath: string, generation: number) => {
			currentIds = filePoints(fileA).map((point) => point.id)
			for (const point of delayedPoints) points.set(point.id, point)
			return count(filePath, generation)
		})
		const progress = vi.fn()
		failures.resetAllBudgets()
		const result = await scanner.scanDirectory(workspacePath, vi.fn(), progress)
		expect(Date.now()).toBe(rejectedAt)
		expect(result.incompleteFiles).toEqual([fileA])
		expect(cache.getHash(fileA)).toBeUndefined()
		expect(cache.getOpenFiles()[fileA]).toBe(true)
		expect(progress).not.toHaveBeenCalled()
		expect(currentIds).toHaveLength(1)
		expect(filePoints(fileA)).toHaveLength(2)
		for (const pointId of currentIds) expect(points.has(pointId)).toBe(true)
		failures.resetAllBudgets()
		const retry = scanner.scanDirectory(workspacePath)
		await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS)
		await retry
		expect(filePoints(fileA)).toHaveLength(1)
		expect(cache.getHash(fileA)).toBe(contentHash)
	})

	it("T12 recovered open-file grace starts at cache load completion, not later scanner dispatch", async () => {
		await cache.invalidateFile(fileA)
		const read = vi.mocked(vscode.workspace.fs.readFile).getMockImplementation()!
		const held = deferred<Uint8Array>()
		vi.mocked(vscode.workspace.fs.readFile).mockImplementationOnce(() => held.promise)
		const fresh = new CacheManager(context, workspacePath)
		const loading = fresh.initialize()
		await vi.advanceTimersByTimeAsync(5000)
		held.resolve(Buffer.from(JSON.stringify(storage.snapshot)))
		await loading
		gate.recover(Object.keys(fresh.getOpenFiles()), fresh.loadedAt)
		const loadedAt = Date.now()
		expect(fresh.loadedAt).toBe(loadedAt)
		cache = fresh
		generations = new GenerationAllocator(cache)
		await vi.advanceTimersByTimeAsync(7000)
		vi.mocked(vscode.workspace.fs.readFile).mockImplementation(read)
		const { orchestrator, state } = createOrchestrator()
		const pending = orchestrator.startIndexing()
		await drain()
		expect(gate.graceDeadline(fileA)).toBe(loadedAt + LATE_WRITE_GRACE_MS)
		expect(cache.getHash(fileA)).toBeUndefined()
		expect(state.state).toBe("Indexing")
		await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS - 7001)
		expect(cache.getHash(fileA)).toBeUndefined()
		expect(state.state).toBe("Indexing")
		await vi.advanceTimersByTimeAsync(1)
		await pending
		expect(cache.getHash(fileA)).toBe(contentHash)
		expect(state.state).toBe("Indexed")
	})

	it.each(["replacement", "removal", "exclusion"])(
		"T17 fresh cache reload at first %s mutation is durably open",
		async (operation) => {
			cache.completeFile(fileA, "previous hash")
			await cache.flush()
			seed(fileA)
			if (operation === "removal") listedPaths = []
			if (operation === "exclusion") ignore.ignores.mockReturnValue(true)
			const mutation = operation === "replacement" ? store.upsertPoints : store.deletePointsByFilePath
			const apply = mutation.getMockImplementation()!
			let observed = false
			mutation.mockImplementationOnce(async (...parameters: any[]) => {
				expect(store.upsertPoints.mock.calls.length + store.deletePointsByFilePath.mock.calls.length).toBe(1)
				const fresh = new CacheManager(context, workspacePath)
				await fresh.initialize()
				expect(fresh.loadSucceeded).toBe(true)
				expect(fresh.getHash(fileA)).toBeUndefined()
				expect(fresh.getOpenFiles()[fileA]).toBe(true)
				observed = true
				await apply(...parameters)
			})
			await scanner.scanDirectory(workspacePath)
			expect(observed).toBe(true)
			expect(cache.getOpenFiles()).toEqual({})
		},
	)

	it("T18 all batches are registered before first embedding dispatch", async () => {
		parser.parseFile.mockResolvedValue(blocks(fileA, 3))
		const register = vi.spyOn(FileCompletion.prototype, "register")
		const registered = vi.spyOn(FileCompletion.prototype, "registered")
		const held = deferred<{ embeddings: number[][] }>()
		embedder.createEmbeddings.mockImplementationOnce(() => {
			expect(register).toHaveBeenCalledTimes(3)
			expect(registered).toHaveBeenCalledOnce()
			const completion = registered.mock.contexts[0] as FileCompletion
			expect(completion.registrationComplete).toBe(true)
			expect(completion.outstanding).toBe(3)
			return held.promise
		})
		const pending = scanner.scanDirectory(workspacePath)
		await drain()
		expect(embedder.createEmbeddings).toHaveBeenCalledOnce()
		expect(cache.getHash(fileA)).toBeUndefined()
		held.resolve({ embeddings: [[1]] })
		await pending
		expect(store.upsertPoints).toHaveBeenCalledTimes(3)
		expect(cache.getHash(fileA)).toBe(contentHash)
	})

	it.each(["none", "late", "late-reject", "late-abort", "cancel-prior", "cancel-grace", "settled", "unrelated"])(
		"T12/T19 real scanner pre-expiry retry completion barrier: %s",
		async (outcome) => {
			const held = deferred<void>()
			let oldPoints: any[] = []
			store.upsertPoints.mockImplementationOnce(async (newPoints: any[]) => {
				oldPoints = newPoints
				if (outcome === "settled") for (const point of newPoints) points.set(point.id, point)
				await held.promise
			})
			let oldIsCurrent = true
			const old = createOrchestrator(() => oldIsCurrent)
			const oldPending = old.orchestrator.startIndexing()
			await drain()
			expect(store.upsertPoints).toHaveBeenCalledOnce()
			const expiryAt = Date.now() + INDEX_STOP_LIMIT_MS
			const stopped = old.orchestrator.stopIndexing()
			expect(old.state.state).toBe("Stopping")
			oldIsCurrent = false
			await vi.advanceTimersByTimeAsync(INDEX_STOP_LIMIT_MS - 2)
			const verified: { at: number; counts: { current: number; other: number } }[] = []
			const count = store.countPointsForFile.getMockImplementation()!
			store.countPointsForFile.mockImplementation(async (filePath: string, generation: number) => {
				const counts = await count(filePath, generation)
				if (filePath === fileA) verified.push({ at: Date.now(), counts })
				return counts
			})
			if (outcome === "unrelated") listedPaths = [fileA, fileB]
			old.state.reportBlockIndexingProgress.mockClear()
			const retry = createOrchestrator(() => true, old.state)
			let finishedAt: number | undefined
			const pending = retry.orchestrator.startIndexing().then(() => {
				finishedAt = Date.now()
			})
			await drain()
			const completedBlocks = outcome === "unrelated" ? 1 : 0
			const currentIds = filePoints(fileA).map((point) => point.id)
			const unrelatedIds = filePoints(fileB).map((point) => point.id)
			const assertIncomplete = () => {
				expect(cache.getHash(fileA)).toBeUndefined()
				expect(cache.getOpenFiles()[fileA]).toBe(true)
				expect(retry.state.state).toBe("Indexing")
				expect(finishedAt).toBeUndefined()
				expect(store.markIndexingComplete).not.toHaveBeenCalled()
				expect(
					retry.state.reportBlockIndexingProgress.mock.calls.every(
						([indexed]: number[]) => indexed <= completedBlocks,
					),
				).toBe(true)
				if (outcome === "unrelated") {
					expect(cache.getHash(fileB)).toBe(contentHash)
					expect(filePoints(fileB).map((point) => point.id)).toEqual(unrelatedIds)
					expect(retry.state.reportBlockIndexingProgress).toHaveBeenCalledWith(1, 2, "scan")
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
				await pending
				await stopped
				await oldPending
				expect(finishedAt).toBe(expiryAt - 1)
				expect(gate.needsReconciliation(fileA)).toBe(false)
				expect(verified.at(-1)).toEqual({ at: expiryAt - 1, counts: { current: 1, other: 0 } })
				expect(cache.getHash(fileA)).toBe(contentHash)
				expect(retry.state.state).toBe("Indexed")
				return
			}
			if (outcome === "cancel-prior") {
				await retry.orchestrator.stopIndexing()
				await pending
				expect(retry.state.setSystemState).toHaveBeenLastCalledWith(
					"Standby",
					"embeddings:orchestrator.indexingStoppedPartial",
					"stop",
				)
				expect(cache.getHash(fileA)).toBeUndefined()
				expect(cache.getOpenFiles()[fileA]).toBe(true)
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
			const stateUpdates = retry.state.setSystemState.mock.calls.length
			await vi.advanceTimersByTimeAsync(1000)
			if (outcome === "late") {
				for (const point of oldPoints) points.set(point.id, point)
				held.resolve()
				await oldPending
				await drain()
				expect(gate.graceDeadline(fileA)).toBe(deadline)
			}
			if (outcome === "late-reject" || outcome === "late-abort") {
				held.reject(
					outcome === "late-abort"
						? new DOMException("late cancellation rejection", "AbortError")
						: new Error("late old write rejection"),
				)
				await oldPending
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
				await retry.orchestrator.stopIndexing()
				await pending
				expect(retry.state.setSystemState).toHaveBeenLastCalledWith(
					"Standby",
					"embeddings:orchestrator.indexingStoppedPartial",
					"stop",
				)
				expect(cache.getHash(fileA)).toBeUndefined()
				expect(cache.getOpenFiles()[fileA]).toBe(true)
				return
			}
			await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1)
			assertIncomplete()
			expect(retry.state.setSystemState).toHaveBeenCalledTimes(stateUpdates)
			await vi.advanceTimersByTimeAsync(1)
			await pending
			expect(finishedAt).toBe(deadline)
			expect(verified.at(-1)).toEqual({
				at: deadline,
				counts: { current: 1, other: outcome === "late" ? 1 : 0 },
			})
			for (const pointId of currentIds) expect(points.has(pointId)).toBe(true)
			if (outcome === "late") {
				expect(cache.getHash(fileA)).toBeUndefined()
				expect(cache.getOpenFiles()[fileA]).toBe(true)
				expect(retry.state.setSystemState).toHaveBeenLastCalledWith(
					"Standby",
					"embeddings:orchestrator.indexingFilesFailed",
					"scan-end",
				)
				expect(store.markIndexingComplete).not.toHaveBeenCalled()
			} else {
				expect(cache.getHash(fileA)).toBe(contentHash)
				expect(retry.state.state).toBe("Indexed")
				expect(store.markIndexingComplete).toHaveBeenCalledOnce()
				if (outcome === "unrelated") {
					expect(cache.getHash(fileB)).toBe(contentHash)
					expect(filePoints(fileB).map((point) => point.id)).toEqual(unrelatedIds)
				}
			}
		},
	)

	it("T29 scanner submits whole Unicode characters and verifies the complete source hash", async () => {
		const filePath = path.join(workspacePath, "unicode.md")
		const source = "a".repeat(MAX_BLOCK_CHARS - 1) + "\u{1f600}" + "漢é".repeat(MAX_BLOCK_CHARS)
		listedPaths = [filePath]
		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from(source))
		parser = new CodeParser()
		scanner = createScanner()
		const errors = vi.fn()
		const result = await scanner.scanDirectory(workspacePath, errors)
		const submitted = embedder.createEmbeddings.mock.calls.flatMap(([texts]: [string[]]) => texts)
		expect(submitted.length).toBeGreaterThan(1)
		expect(submitted[0]).toHaveLength(MAX_BLOCK_CHARS - 1)
		for (const text of submitted) {
			expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)
			expect(Buffer.from(text).toString("utf8")).toBe(text)
		}
		expect(submitted.join("")).toBe(source)
		expect(errors).not.toHaveBeenCalled()
		expect(result.incompleteFiles).toEqual([])
		const stored = filePoints(filePath)
		expect(stored).toHaveLength(submitted.length)
		expect(store.countPointsForFile).toHaveBeenCalledWith(filePath, stored[0].payload.generation)
		expect(cache.getHash(filePath)).toBe(createHash("sha256").update(source).digest("hex"))
		expect(cache.getOpenFiles()).toEqual({})
	})

	it.each(["embed", "upsert"] as const)("T30 scan disable interrupts a 30s %s transport wait", async (activity) => {
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
			const realStore = new QdrantVectorStore(workspacePath, "https://store.test", 1)
			store.upsertPoints.mockImplementation((batch: any[]) => realStore.upsertPoints(batch))
		}
		const { orchestrator, state } = createOrchestrator()
		const pending = orchestrator.startIndexing()
		await drain()
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
		await pending
		await vi.advanceTimersByTimeAsync(60_000)
		expect(transportCalls()).toHaveLength(1)
		expect(points.size).toBe(0)
		if (activity === "embed") expect(store.upsertPoints).not.toHaveBeenCalled()
		else expect(store.upsertPoints).toHaveBeenCalledOnce()
		expect(store.deletePointsByFilePath).not.toHaveBeenCalled()
		expect(store.countPointsForFile).not.toHaveBeenCalled()
		expect(cache.getHash(fileA)).toBeUndefined()
		expect(failures.list()).toEqual([])
		expect(state.setSystemState).toHaveBeenLastCalledWith(
			"Standby",
			"embeddings:orchestrator.indexingStoppedPartial",
			"stop",
		)
	})

	it("T22 real parser single-line segments have distinct generation IDs and verified counts", async () => {
		const markdownPath = path.join(workspacePath, "long.md")
		listedPaths = [markdownPath]
		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(Buffer.from("abcdefghij".repeat(500)))
		parser = new CodeParser()
		scanner = createScanner()
		const errors = vi.fn()
		const result = await scanner.scanDirectory(workspacePath, errors)
		expect(errors.mock.calls).toEqual([])
		const stored = filePoints(markdownPath)
		expect(stored.length).toBeGreaterThan(1)
		expect(new Set(stored.map((point) => point.id)).size).toBe(stored.length)
		expect(new Set(stored.map((point) => point.payload.startLine)).size).toBe(1)
		expect(result.totalBlockCount).toBe(stored.length)
		expect(result.incompleteFiles).toEqual([])
		expect(store.countPointsForFile).toHaveBeenCalledWith(markdownPath, stored[0].payload.generation)
		expect(cache.getHash(markdownPath)).toBeDefined()
	})
})
