import * as vscode from "vscode"
import { CacheManager } from "../cache-manager"
import { GenerationAllocator } from "../generation-allocator"
import { IndexWriteGate, LATE_WRITE_GRACE_MS } from "../index-write-gate"
import { safeWriteJson } from "../../../utils/safeWriteJson"

vi.mock("../../../utils/safeWriteJson", () => ({ safeWriteJson: vi.fn() }))
vi.mock("vscode", () => ({
	Uri: { joinPath: vi.fn(() => ({ fsPath: "/storage/cache.json" })) },
	workspace: { fs: { readFile: vi.fn() } },
}))

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((complete) => {
		resolve = complete
	})
	return { promise, resolve }
}

describe("GenerationAllocator", () => {
	let persisted: unknown
	let cache: CacheManager
	let gate: IndexWriteGate
	let attempt: AbortController
	let store: any

	async function loadCache(data: unknown) {
		vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async () => {
			if (data === undefined) throw new Error("Missing cache")
			return Buffer.from(typeof data === "string" ? data : JSON.stringify(data))
		})
		const loaded = new CacheManager({ globalStorageUri: {} } as vscode.ExtensionContext, "/workspace")
		await loaded.initialize()
		return loaded
	}

	beforeEach(async () => {
		vi.useFakeTimers()
		vi.setSystemTime(100_000)
		vi.mocked(safeWriteJson)
			.mockReset()
			.mockImplementation(async (_path, data) => {
				persisted = structuredClone(data)
			})
		persisted = { version: 2, fileHashes: {}, openFiles: {}, generationWatermark: 2048 }
		cache = await loadCache(persisted)
		gate = new IndexWriteGate()
		attempt = new AbortController()
		store = {
			hasIndexedData: vi.fn().mockResolvedValue(false),
			clearCollection: vi.fn().mockResolvedValue(undefined),
		}
	})

	afterEach(() => {
		vi.clearAllTimers()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("awaits a durable 1024-generation reservation before initialization completes", async () => {
		const held = deferred()
		vi.mocked(safeWriteJson).mockImplementationOnce(async (_path, data) => {
			await held.promise
			persisted = structuredClone(data)
		})
		const allocator = new GenerationAllocator(cache)
		const initialized = vi.fn()
		const pending = allocator.initialize(store, attempt.signal, gate).then(initialized)
		await vi.advanceTimersByTimeAsync(0)
		expect(safeWriteJson).toHaveBeenCalledWith(
			"/storage/cache.json",
			expect.objectContaining({ generationWatermark: 3072 }),
		)
		expect(initialized).not.toHaveBeenCalled()
		held.resolve()
		await pending
		await expect(allocator.allocate()).resolves.toBe(2049)
		expect(persisted).toMatchObject({ generationWatermark: 3072 })
	})

	it("serializes concurrent allocation and reserves the next block only after 1024 uses", async () => {
		const allocator = new GenerationAllocator(cache)
		await allocator.initialize(store, attempt.signal, gate)
		const generations = await Promise.all(Array.from({ length: 1024 }, () => allocator.allocate()))
		expect(generations).toEqual(Array.from({ length: 1024 }, (_, offset) => 2049 + offset))
		expect(safeWriteJson).toHaveBeenCalledTimes(1)
		const held = deferred()
		vi.mocked(safeWriteJson).mockImplementationOnce(async (_path, data) => {
			await held.promise
			persisted = structuredClone(data)
		})
		const allocated = vi.fn()
		const next = allocator.allocate().then(allocated)
		await vi.advanceTimersByTimeAsync(0)
		expect(allocated).not.toHaveBeenCalled()
		expect(safeWriteJson).toHaveBeenLastCalledWith(
			"/storage/cache.json",
			expect.objectContaining({ generationWatermark: 4096 }),
		)
		held.resolve()
		await next
		expect(allocated).toHaveBeenCalledWith(3073)
	})

	it("resumes above the entire durable block after reload despite a backwards clock and hash clear", async () => {
		const allocator = new GenerationAllocator(cache)
		await allocator.initialize(store, attempt.signal, gate)
		await expect(allocator.allocate()).resolves.toBe(2049)
		await cache.clearCacheFile()
		vi.setSystemTime(1)
		const reloaded = await loadCache(persisted)
		const nextAllocator = new GenerationAllocator(reloaded)
		const clock = vi.spyOn(Date, "now").mockImplementation(() => {
			throw new Error("Clock must not seed generations")
		})
		await nextAllocator.initialize(store, attempt.signal, gate)
		await expect(nextAllocator.allocate()).resolves.toBe(3073)
		expect(clock).not.toHaveBeenCalled()
	})

	it("propagates reservation failure and retries initialization with a new durable block", async () => {
		const allocator = new GenerationAllocator(cache)
		vi.mocked(safeWriteJson).mockRejectedValueOnce(new Error("Disk full"))
		await expect(allocator.initialize(store, attempt.signal, gate)).rejects.toThrow("Disk full")
		expect(persisted).toMatchObject({ generationWatermark: 2048 })
		await allocator.initialize(store, attempt.signal, gate)
		await expect(allocator.allocate()).resolves.toBe(2049)
		expect(persisted).toMatchObject({ generationWatermark: 4096 })
	})

	it("does not return an unreserved generation after rollover-save failure", async () => {
		const allocator = new GenerationAllocator(cache)
		await allocator.initialize(store, attempt.signal, gate)
		await Promise.all(Array.from({ length: 1024 }, () => allocator.allocate()))
		vi.mocked(safeWriteJson).mockRejectedValueOnce(new Error("Disk full"))
		await expect(allocator.allocate()).rejects.toThrow("Disk full")
		expect(persisted).toMatchObject({ generationWatermark: 3072 })
		await expect(allocator.allocate()).resolves.toBe(3073)
		expect(persisted).toMatchObject({ generationWatermark: 5120 })
	})

	it("refuses cancellation during reservation and keeps the allocation queue usable", async () => {
		const allocator = new GenerationAllocator(cache)
		await allocator.initialize(store, attempt.signal, gate)
		await Promise.all(Array.from({ length: 1024 }, () => allocator.allocate()))
		const held = deferred()
		vi.mocked(safeWriteJson).mockImplementationOnce(async (_path, data) => {
			await held.promise
			persisted = structuredClone(data)
		})
		const rejected = expect(allocator.allocate(attempt.signal)).rejects.toMatchObject({ name: "AbortError" })
		await vi.advanceTimersByTimeAsync(0)
		attempt.abort()
		held.resolve()
		await rejected
		await expect(allocator.allocate()).resolves.toBe(3073)
		expect(persisted).toMatchObject({ generationWatermark: 5120 })
	})

	it.each([undefined, "unreadable JSON", { "file.ts": "legacy-hash" }])(
		"clears nonempty storage before reserving when ordering is unknown (%j)",
		async (data) => {
			cache = await loadCache(data)
			store.hasIndexedData.mockResolvedValue(true)
			const held = deferred()
			store.clearCollection.mockReturnValue(held.promise)
			const allocator = new GenerationAllocator(cache)
			const pending = allocator.initialize(store, attempt.signal, gate)
			await vi.advanceTimersByTimeAsync(0)
			expect(store.clearCollection).toHaveBeenCalledOnce()
			expect(safeWriteJson).not.toHaveBeenCalled()
			held.resolve()
			await pending
			expect(vi.mocked(safeWriteJson).mock.calls.map((call) => call[1])).toEqual([
				{ version: 2, fileHashes: {}, openFiles: {}, generationWatermark: undefined },
				{ version: 2, fileHashes: {}, openFiles: {}, generationWatermark: 1024 },
			])
			await expect(allocator.allocate()).resolves.toBe(1)
		},
	)

	it("does not clear an empty collection with unknown ordering", async () => {
		cache = await loadCache("unreadable JSON")
		const allocator = new GenerationAllocator(cache)
		await allocator.initialize(store, attempt.signal, gate)
		expect(store.hasIndexedData).toHaveBeenCalledOnce()
		expect(store.clearCollection).not.toHaveBeenCalled()
		await expect(allocator.allocate()).resolves.toBe(1)
	})

	it("refuses initialization if reset clearing fails and does not reserve generations", async () => {
		cache = await loadCache({ "file.ts": "legacy" })
		store.hasIndexedData.mockResolvedValue(true)
		store.clearCollection.mockRejectedValue(new Error("Clear failed"))
		await expect(new GenerationAllocator(cache).initialize(store, attempt.signal, gate)).rejects.toThrow(
			"Clear failed",
		)
		expect(safeWriteJson).not.toHaveBeenCalled()
	})

	it("preserves manager-recovered cache-load grace without recovering again at allocator start", async () => {
		cache = await loadCache({
			version: 2,
			fileHashes: {},
			openFiles: { "file.ts": true },
			generationWatermark: 1024,
		})
		gate.recover(Object.keys(cache.getOpenFiles()), cache.loadedAt)
		const recover = vi.spyOn(gate, "recover")
		await vi.advanceTimersByTimeAsync(10_000)
		await new GenerationAllocator(cache).initialize(store, attempt.signal, gate)
		expect(recover).not.toHaveBeenCalled()
		const done = vi.fn()
		const waiting = gate.waitForGrace("file.ts", attempt.signal).then(done)
		await vi.advanceTimersByTimeAsync(LATE_WRITE_GRACE_MS - 10_001)
		expect(done).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		await waiting
		expect(done).toHaveBeenCalledOnce()
	})

	it("refuses cancelled allocations without consuming a generation", async () => {
		const allocator = new GenerationAllocator(cache)
		await allocator.initialize(store, attempt.signal, gate)
		attempt.abort()
		await expect(allocator.allocate(attempt.signal)).rejects.toMatchObject({ name: "AbortError" })
		await expect(allocator.allocate()).resolves.toBe(2049)
	})

	it("initializes once and rejects generation exhaustion without writing an unsafe integer", async () => {
		const allocator = new GenerationAllocator(cache)
		await allocator.initialize(store, attempt.signal, gate)
		await allocator.initialize(store, attempt.signal, gate)
		expect(safeWriteJson).toHaveBeenCalledTimes(1)
		cache = await loadCache({
			version: 2,
			fileHashes: {},
			openFiles: {},
			generationWatermark: Number.MAX_SAFE_INTEGER,
		})
		vi.mocked(safeWriteJson).mockClear()
		await expect(new GenerationAllocator(cache).initialize(store, attempt.signal, gate)).rejects.toThrow(
			"counter exhausted",
		)
		expect(safeWriteJson).not.toHaveBeenCalled()
	})
})
