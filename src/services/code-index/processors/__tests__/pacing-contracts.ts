import { ProviderPacerRegistry } from "../../provider-pacer"
import { FileFailureRegistry } from "../../file-failure-registry"

export interface PacingHarness {
	paths: string[]
	embedder: any
	store: any
	parser: any
	pacers: ProviderPacerRegistry
	failures: FileFailureRegistry
	start(paths: string[]): Promise<void>
	finish(): Promise<void>
	getHash(filePath: string): string | undefined
	getPoints(filePath: string): any[]
	seed(filePath: string): void
	getStatus(): { state: string; message?: string }
}

export function definePacingContracts(createHarness: () => PacingHarness, vi: (typeof import("vitest"))["vi"]) {
	it("T35 shares embedding pause, keeps in-flight vectors and allows independent store progress", async () => {
		const harness = createHarness()
		const [fileA, fileB, fileC] = harness.paths
		let rejectLimited!: (error: Error) => void
		let finishInflight!: (value: { embeddings: number[][] }) => void
		let releaseParsing!: (value: any[]) => void
		const limited = new Promise<never>((_resolve, reject) => {
			rejectLimited = reject
		})
		const inflight = new Promise<{ embeddings: number[][] }>((resolve) => {
			finishInflight = resolve
		})
		const parsing = new Promise<any[]>((resolve) => {
			releaseParsing = resolve
		})
		const parse = harness.parser.parseFile.getMockImplementation()!
		let delayedBlocks: any[] = []
		harness.parser.parseFile.mockImplementation(async (filePath: string) => {
			const selected = await parse(filePath)
			selected[0].content = filePath
			if (filePath === fileC) {
				delayedBlocks = selected
				return parsing
			}
			return selected
		})
		harness.embedder.createEmbeddings.mockImplementation(async (texts: string[]) => {
			if (texts[0] === fileA && harness.embedder.createEmbeddings.mock.calls.length <= 2) return limited
			if (texts[0] === fileB) return inflight
			return { embeddings: [[7]] }
		})
		await harness.start([fileA, fileB, fileC])
		expect(harness.embedder.createEmbeddings).toHaveBeenCalledTimes(2)
		rejectLimited(Object.assign(new Error("limited"), { status: 429, retryAfterMs: 30_000 }))
		await vi.advanceTimersByTimeAsync(0)
		const resumeAt = Date.now() + 30_000
		releaseParsing(delayedBlocks)
		finishInflight({ embeddings: [[42]] })
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.getHash(fileB)).toBeDefined()
		expect(harness.getPoints(fileB)[0].vector).toEqual([42])
		expect(harness.store.upsertPoints).toHaveBeenCalledOnce()
		expect(harness.pacers.get(harness.store.rateLimitScope).state().pausedUntil).toBeUndefined()
		expect(harness.failures.list()).toEqual([])
		expect(harness.pacers.waitingPaths()).toEqual(expect.arrayContaining(["a.ts", "c.ts"]))
		await vi.advanceTimersByTimeAsync(resumeAt - Date.now() - 1)
		expect(harness.embedder.createEmbeddings).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(1 + 1000)
		await harness.finish()
		for (const filePath of [fileA, fileB, fileC]) expect(harness.getHash(filePath)).toBeDefined()
		expect(
			harness.embedder.createEmbeddings.mock.calls.filter(([texts]: [string[]]) => texts[0] === fileB),
		).toHaveLength(1)
		expect(harness.failures.list()).toEqual([])
	})

	it.each([1, 3])("T37 stages real 200-file recovery after %s rate-limited waves", async (episodes) => {
		const harness = createHarness()
		const random = vi.spyOn(Math, "random").mockReturnValue(0)
		const issuedAt: number[] = []
		let releaseProbe!: (value: { embeddings: number[][] }) => void
		const probe = new Promise<{ embeddings: number[][] }>((resolve) => {
			releaseProbe = resolve
		})
		let probeHeld = false
		harness.embedder.createEmbeddings.mockImplementation(async (texts: string[]) => {
			issuedAt.push(Date.now())
			const pacer = harness.pacers.get(harness.embedder.rateLimitScope)
			const snapshot = pacer.state()
			if (!probeHeld && (snapshot.consecutiveRateLimits < episodes || snapshot.pausedUntil !== undefined)) {
				throw Object.assign(new Error("limited"), { status: 429 })
			}
			if (!probeHeld) {
				probeHeld = true
				return probe
			}
			return { embeddings: texts.map(() => [1]) }
		})
		try {
			await harness.start(harness.paths)
			const waveAt = [issuedAt[0]]
			for (let episode = 1; episode <= episodes; episode++) {
				const snapshot = harness.pacers.get(harness.embedder.rateLimitScope).state()
				expect(snapshot.consecutiveRateLimits).toBe(episode)
				expect(snapshot.limit).toBe([5, 2, 1][episode - 1])
				expect(snapshot.pausedUntil).toBeDefined()
				const calls = issuedAt.length
				await vi.advanceTimersByTimeAsync(snapshot.pausedUntil! - Date.now() - 1)
				expect(issuedAt).toHaveLength(calls)
				await vi.advanceTimersByTimeAsync(1)
				expect(issuedAt).toHaveLength(calls + 1)
				waveAt.push(issuedAt.at(-1)!)
				expect(harness.failures.list()).toEqual([])
			}
			expect(waveAt.slice(1).map((time, index) => time - waveAt[index])).toEqual(
				[500, 1000, 2000].slice(0, episodes),
			)
			const calls = issuedAt.length
			await vi.advanceTimersByTimeAsync(500)
			expect(issuedAt).toHaveLength(calls)
			releaseProbe({ embeddings: [[1]] })
			await vi.advanceTimersByTimeAsync(0)
			const resumedAt = Date.now()
			const stagedRequests = episodes === 1 ? 4 : 1
			for (let released = 0; released < stagedRequests; released++) {
				await vi.advanceTimersByTimeAsync(124)
				expect(issuedAt).toHaveLength(calls + released)
				await vi.advanceTimersByTimeAsync(1)
				expect(issuedAt[calls + released]).toBe(resumedAt + 125 * (released + 1))
			}
			await vi.advanceTimersByTimeAsync(10_000)
			await harness.finish()
			for (const filePath of harness.paths) expect(harness.getHash(filePath)).toBeDefined()
			expect(harness.failures.list()).toEqual([])
			expect(harness.pacers.providerWaits()).toEqual([])
		} finally {
			random.mockRestore()
		}
	})

	it("T38 keeps a genuine exhausted failure visible alongside two independent provider waits", async () => {
		const harness = createHarness()
		const [fileA, fileB, fileC] = harness.paths
		const parse = harness.parser.parseFile.getMockImplementation()!
		let releaseEmbedFile!: () => void
		let releaseStoreFile!: () => void
		const embedFile = new Promise<void>((resolve) => {
			releaseEmbedFile = resolve
		})
		const storeFile = new Promise<void>((resolve) => {
			releaseStoreFile = resolve
		})
		harness.parser.parseFile.mockImplementation(async (filePath: string) => {
			if (filePath === fileB) await embedFile
			if (filePath === fileC) await storeFile
			const selected = await parse(filePath)
			selected[0].content = filePath
			return selected
		})
		let embeddingLimited = true
		harness.embedder.createEmbeddings.mockImplementation(async (texts: string[]) => {
			if (texts[0] === fileA) throw Object.assign(new Error("unavailable"), { status: 500 })
			if (texts[0] === fileB && embeddingLimited) {
				embeddingLimited = false
				throw Object.assign(new Error("limited"), { status: 429, retryAfterMs: 30_000 })
			}
			return { embeddings: [[1]] }
		})
		const upsert = harness.store.upsertPoints.getMockImplementation()!
		harness.store.upsertPoints
			.mockRejectedValueOnce(Object.assign(new Error("store limited"), { status: 429, retryAfterMs: 30_000 }))
			.mockImplementation(upsert)
		await harness.start([fileA, fileB, fileC])
		await vi.advanceTimersByTimeAsync(1500)
		expect(harness.failures.list()).toEqual([
			expect.objectContaining({ path: "a.ts", classification: "server", state: "exhausted" }),
		])
		releaseStoreFile()
		await vi.advanceTimersByTimeAsync(0)
		releaseEmbedFile()
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.pacers.providerWaits()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ service: "openai", resumeAt: Date.now() + 30_000, waitingFiles: ["b.ts"] }),
				expect.objectContaining({ service: "qdrant", resumeAt: Date.now() + 30_000, waitingFiles: ["c.ts"] }),
			]),
		)
		expect(harness.getStatus().state).toBe("Indexing")
		expect(harness.getStatus().message).toBe(
			"embeddings:orchestrator.providerWaitingUntil\nembeddings:orchestrator.providerWaitingUntil",
		)
		expect(harness.failures.list()).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(32_000)
		expect(harness.getHash(fileB)).toBeDefined()
		expect(harness.getHash(fileC)).toBeDefined()
		await harness.finish()
		expect(harness.pacers.providerWaits()).toEqual([])
		expect(harness.getStatus().message).not.toContain("providerWaiting")
		expect(harness.getStatus().state).toBe("Standby")
		expect(harness.failures.list()).toEqual([expect.objectContaining({ path: "a.ts", state: "exhausted" })])
		expect(harness.getHash(fileB)).toBeDefined()
		expect(harness.getHash(fileC)).toBeDefined()
	})

	it("T40 preserves the first portion through three 429s and hashes only after final upsert and verification", async () => {
		const harness = createHarness()
		const filePath = harness.paths[0]
		harness.seed(filePath)
		const parse = harness.parser.parseFile.getMockImplementation()!
		harness.parser.parseFile.mockImplementation(async (file: string) => {
			const [first] = await parse(file)
			return [first, { ...first, content: "second portion", segmentHash: "second" }]
		})
		let failuresLeft = 3
		harness.embedder.createEmbeddings.mockImplementation(async (texts: string[]) => {
			if (texts[0] === "second portion" && failuresLeft-- > 0) {
				throw Object.assign(new Error("limited"), { status: 429, retryAfterMs: 2000 })
			}
			return { embeddings: [[texts[0] === "second portion" ? 2 : 1]] }
		})
		let releaseUpsert!: () => void
		let releaseVerify!: () => void
		const heldUpsert = new Promise<void>((resolve) => {
			releaseUpsert = resolve
		})
		const heldVerify = new Promise<void>((resolve) => {
			releaseVerify = resolve
		})
		const upsert = harness.store.upsertPoints.getMockImplementation()!
		harness.store.upsertPoints.mockImplementation(async (batch: any[]) => {
			if (batch[0].payload.codeChunk === "second portion") await heldUpsert
			await upsert(batch)
		})
		const count = harness.store.countPointsForFile.getMockImplementation()!
		harness.store.countPointsForFile.mockImplementation(async (...parameters: any[]) => {
			await heldVerify
			return count(...parameters)
		})
		await harness.start([filePath])
		for (let pause = 0; pause < 3; pause++) {
			expect(harness.getHash(filePath)).toBeUndefined()
			expect(harness.failures.list()).toEqual([])
			expect(harness.store.upsertPoints).toHaveBeenCalledTimes(1)
			await vi.advanceTimersByTimeAsync(2000)
		}
		expect(harness.store.upsertPoints).toHaveBeenCalledTimes(2)
		expect(harness.store.countPointsForFile).not.toHaveBeenCalled()
		expect(harness.getHash(filePath)).toBeUndefined()
		releaseUpsert()
		await vi.advanceTimersByTimeAsync(0)
		expect(harness.store.countPointsForFile).toHaveBeenCalledOnce()
		expect(harness.getHash(filePath)).toBeUndefined()
		releaseVerify()
		await vi.advanceTimersByTimeAsync(0)
		await harness.finish()
		expect(harness.getHash(filePath)).toBeDefined()
		expect(harness.getPoints(filePath).map((point) => point.vector)).toEqual([[1], [2]])
		expect(
			harness.embedder.createEmbeddings.mock.calls.filter(([texts]: [string[]]) => texts[0] !== "second portion"),
		).toHaveLength(1)
		expect(harness.failures.list()).toEqual([])
	})
}
