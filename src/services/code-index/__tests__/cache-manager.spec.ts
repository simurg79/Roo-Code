import * as path from "path"
import "./mock-code-index-log"
import { codeIndexLog } from "../code-index-log"
import * as vscode from "vscode"
import { createHash } from "crypto"
import { CacheManager } from "../cache-manager"
import { safeWriteJson } from "../../../utils/safeWriteJson"

vi.mock("../../../utils/safeWriteJson", () => ({ safeWriteJson: vi.fn() }))
vi.mock("vscode", () => ({
	Uri: { joinPath: vi.fn() },
	workspace: { fs: { readFile: vi.fn() } },
}))

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((complete) => {
		resolve = complete
	})
	return { promise, resolve }
}

describe("CacheManager", () => {
	const cachePath = { fsPath: "/storage/cache.json" } as vscode.Uri
	const context = { globalStorageUri: { fsPath: "/storage" } } as vscode.ExtensionContext
	let cache: CacheManager
	let persisted: unknown

	function freshCache() {
		return new CacheManager(context, "/workspace")
	}

	beforeEach(() => {
		vi.useFakeTimers()
		vi.resetAllMocks()
		persisted = undefined
		vi.mocked(vscode.Uri.joinPath).mockReturnValue(cachePath)
		vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async () => {
			if (persisted === undefined) throw new Error("Missing cache")
			return Buffer.from(JSON.stringify(persisted))
		})
		vi.mocked(safeWriteJson).mockImplementation(async (_path, data) => {
			persisted = structuredClone(data)
		})
		cache = freshCache()
	})

	afterEach(() => {
		vi.clearAllTimers()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("uses a workspace-specific hashed cache path", () => {
		const workspaceHash = createHash("sha256").update("/workspace").digest("hex")
		expect(vscode.Uri.joinPath).toHaveBeenCalledWith(
			context.globalStorageUri,
			`roo-index-cache-${workspaceHash}.json`,
		)
	})

	it("loads legacy hashes without inventing a generation watermark", async () => {
		persisted = { "file.ts": "hash" }
		await cache.initialize()
		expect(cache.loadSucceeded).toBe(true)
		expect(cache.getAllHashes()).toEqual(persisted)
		expect(cache.generationWatermark).toBeUndefined()
	})

	it("loads open records ahead of stale hashes and records cache-load completion time", async () => {
		persisted = {
			version: 2,
			fileHashes: { "open.ts": "stale", "complete.ts": "hash" },
			openFiles: { "open.ts": true, "deleted.ts": true },
			generationWatermark: 2048,
		}
		vi.setSystemTime(12345)
		await cache.initialize()
		expect(cache.loadedAt).toBe(12345)
		expect(cache.loadSucceeded).toBe(true)
		expect(cache.generationWatermark).toBe(2048)
		expect(cache.getHash("open.ts")).toBeUndefined()
		expect(cache.getTrackedPaths().sort()).toEqual(
			["complete.ts", "deleted.ts", "open.ts"].map((filePath) => path.resolve("/workspace", filePath)),
		)
		const openFiles = cache.getOpenFiles()
		delete openFiles["deleted.ts"]
		const hashes = cache.getAllHashes()
		hashes["complete.ts"] = "changed"
		expect(cache.getOpenFiles()).toEqual({
			[path.resolve("/workspace", "open.ts")]: true,
			[path.resolve("/workspace", "deleted.ts")]: true,
		})
		expect(cache.getHash("complete.ts")).toBe("hash")
	})

	it.each([undefined, "invalid JSON", { version: 2, fileHashes: { "file.ts": 4 }, openFiles: {} }])(
		"resets unreadable or invalid cache state (%j)",
		async (data) => {
			cache.completeFile("previous.ts", "old")
			persisted = data
			if (data === "invalid JSON") {
				vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(Buffer.from(data))
			}
			await cache.initialize()
			expect(cache.loadSucceeded).toBe(false)
			expect(cache.getAllHashes()).toEqual({})
			expect(cache.getOpenFiles()).toEqual({})
			expect(cache.generationWatermark).toBeUndefined()
		},
	)

	it("awaits durable invalidation and reloads an unfinished file without a hash", async () => {
		cache.completeFile("file.ts", "hash")
		await cache.flush()
		const held = deferred()
		vi.mocked(safeWriteJson).mockImplementationOnce(async (_path, data) => {
			await held.promise
			persisted = structuredClone(data)
		})
		const saved = vi.fn()
		const invalidation = cache.invalidateFile("file.ts").then(saved)
		await vi.advanceTimersByTimeAsync(0)
		expect(saved).not.toHaveBeenCalled()
		expect(cache.getHash("file.ts")).toBeUndefined()
		held.resolve()
		await invalidation
		const reloaded = freshCache()
		await reloaded.initialize()
		expect(reloaded.getHash("file.ts")).toBeUndefined()
		expect(reloaded.getOpenFiles()).toEqual({ [path.resolve("/workspace", "file.ts")]: true })
	})

	it("serializes an already-issued older snapshot before durable invalidation", async () => {
		const held = deferred()
		vi.mocked(safeWriteJson).mockImplementationOnce(async (_path, data) => {
			await held.promise
			persisted = structuredClone(data)
		})
		cache.completeFile("file.ts", "old")
		await vi.advanceTimersByTimeAsync(1500)
		expect(safeWriteJson).toHaveBeenCalledTimes(1)
		const invalidation = cache.invalidateFile("file.ts")
		await vi.advanceTimersByTimeAsync(0)
		expect(safeWriteJson).toHaveBeenCalledTimes(1)
		held.resolve()
		await invalidation
		expect(persisted).toMatchObject({ fileHashes: {}, openFiles: { "file.ts": true } })
		await vi.advanceTimersByTimeAsync(1500)
		expect(safeWriteJson).toHaveBeenCalledTimes(2)
	})

	it("propagates durable-save failure, retains the open record, and allows a later save", async () => {
		cache.completeFile("file.ts", "hash")
		vi.mocked(safeWriteJson).mockRejectedValueOnce(new Error("Disk full"))
		await expect(cache.invalidateFile("file.ts")).rejects.toThrow("Disk full")
		expect(cache.getHash("file.ts")).toBeUndefined()
		expect(cache.getOpenFiles()).toEqual({ [path.resolve("/workspace", "file.ts")]: true })
		await cache.flush()
		expect(persisted).toMatchObject({ fileHashes: {}, openFiles: { "file.ts": true } })
	})

	it("debounces completion and removes the open record in the same snapshot as its hash", async () => {
		await cache.invalidateFile("file.ts")
		vi.mocked(safeWriteJson).mockClear()
		cache.completeFile("file.ts", "current")
		expect(safeWriteJson).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1499)
		expect(safeWriteJson).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(safeWriteJson).toHaveBeenCalledWith(cachePath.fsPath, {
			version: 2,
			fileHashes: { "file.ts": "current" },
			openFiles: {},
			generationWatermark: undefined,
		})
	})

	it("tracks completed and open files until removal completes without enumerating paths", async () => {
		const enumerate = vi.spyOn(cache, "getTrackedPaths")
		cache.completeFile("file.ts", "hash")
		expect(cache.isTracked("file.ts")).toBe(true)
		expect(cache.isTracked("missing.ts")).toBe(false)
		expect(cache.isTracked("toString")).toBe(false)
		await cache.invalidateFile("file.ts")
		expect(cache.isTracked("file.ts")).toBe(true)
		expect(cache.getHash("file.ts")).toBeUndefined()
		expect(enumerate).not.toHaveBeenCalled()
		expect(cache.getTrackedPaths()).toEqual([path.resolve("/workspace", "file.ts")])
		cache.completeRemoval("file.ts")
		await cache.flush()
		expect(cache.isTracked("file.ts")).toBe(false)
		expect(cache.getTrackedPaths()).toEqual([])
		expect(persisted).toMatchObject({ fileHashes: {}, openFiles: {} })
	})

	it("persists the reserved watermark through hash and open-record clears", async () => {
		await cache.reserveGenerations(4096)
		cache.completeFile("complete.ts", "hash")
		await cache.invalidateFile("open.ts")
		await cache.clearCacheFile()
		expect(cache.generationWatermark).toBe(4096)
		expect(persisted).toEqual({ version: 2, fileHashes: {}, openFiles: {}, generationWatermark: 4096 })
		const reloaded = freshCache()
		await reloaded.initialize()
		expect(reloaded.generationWatermark).toBe(4096)
	})

	it("propagates hash-clear errors instead of claiming durable success", async () => {
		vi.mocked(safeWriteJson).mockRejectedValueOnce(new Error("Write denied"))
		await expect(cache.clearCacheFile()).rejects.toThrow("Write denied")
	})

	it("loads a pre-change cache file so relative and absolute workspace lookups hit the same entry", async () => {
		persisted = {
			version: 2,
			fileHashes: { "src/kept.ts": "kept-hash", [path.resolve("/workspace", "abs.ts")]: "abs-hash" },
			openFiles: { "src/open.ts": true },
		}
		await cache.initialize()
		expect(cache.loadSucceeded).toBe(true)
		expect(cache.getHash("src/kept.ts")).toBe("kept-hash")
		expect(cache.getHash(path.resolve("/workspace", "src/kept.ts"))).toBe("kept-hash")
		expect(cache.getHash("abs.ts")).toBe("abs-hash")
		expect(cache.isTracked(path.resolve("/workspace", "src/open.ts"))).toBe(true)
		expect(cache.getTrackedPaths().sort()).toEqual(
			["src/kept.ts", "abs.ts", "src/open.ts"].map((file) => path.resolve("/workspace", file)).sort(),
		)
		cache.completeRemoval(path.resolve("/workspace", "src/kept.ts"))
		await cache.flush()
		expect(cache.isTracked("src/kept.ts")).toBe(false)
	})

	it("logs debounced-save errors without an unhandled rejection", async () => {
		const log = vi.spyOn(codeIndexLog, "error").mockImplementation(() => {})
		vi.mocked(safeWriteJson).mockRejectedValueOnce(new Error("Write denied"))
		cache.completeFile("file.ts", "hash")
		await vi.advanceTimersByTimeAsync(1500)
		expect(log).toHaveBeenCalledWith("Failed to save cache:", expect.any(Error))
	})
})
