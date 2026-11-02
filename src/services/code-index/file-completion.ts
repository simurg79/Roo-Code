import { v5 as uuidv5 } from "uuid"
import { CacheManager } from "./cache-manager"
import { GenerationAllocator } from "./generation-allocator"
import { IndexWriteGate } from "./index-write-gate"
import { CodeBlock, IEmbedder, IVectorStore } from "./interfaces"
import { BATCH_SEGMENT_THRESHOLD, QDRANT_CODE_BLOCK_NAMESPACE } from "./constants"
import { generateRelativeFilePath } from "./shared/get-relative-path"
import { throwIfAborted } from "./parser-errors"

export class FileCompletion {
	public registrationComplete = false
	public outstanding = 0
	public failed = false
	private finishing?: Promise<void>

	constructor(private readonly finish: () => Promise<void>) {}

	register(): void {
		if (this.registrationComplete) throw new Error("File registration already complete")
		this.outstanding++
	}

	async settled(success: boolean): Promise<void> {
		this.failed ||= !success
		this.outstanding--
		await this.tryComplete()
	}

	async registered(): Promise<void> {
		this.registrationComplete = true
		await this.tryComplete()
	}

	private async tryComplete(): Promise<void> {
		if (!this.registrationComplete || this.outstanding !== 0 || this.failed) return
		this.finishing ??= this.finish().catch((error) => {
			this.failed = true
			throw error
		})
		await this.finishing
	}
}

export class FileIndexWriter {
	constructor(
		private readonly cache: CacheManager,
		private readonly store: IVectorStore,
		private readonly gate: IndexWriteGate,
		private readonly generations: GenerationAllocator,
		private readonly workspacePath: string,
	) {}

	async remove(filePath: string, signal: AbortSignal): Promise<void> {
		const generation = await this.generations.allocate(signal)
		await this.gate.run(signal, () => this.cache.invalidateFile(filePath))
		await this.gate.run(signal, () => this.store.deletePointsByFilePath(filePath, generation), [filePath])
		throwIfAborted(signal)
		this.cache.completeRemoval(filePath)
	}

	async replace(
		filePath: string,
		hash: string,
		blocks: CodeBlock[],
		embedder: IEmbedder,
		signal: AbortSignal,
		batchSize = BATCH_SEGMENT_THRESHOLD,
		onComplete?: (blockCount: number) => void,
	): Promise<void> {
		const generation = await this.generations.allocate(signal)
		await this.gate.run(signal, () => this.cache.invalidateFile(filePath))
		const selected = blocks.filter((block) => block.content.trim())
		const verify = async () => {
			throwIfAborted(signal)
			const counts = await this.store.countPointsForFile(filePath, generation)
			throwIfAborted(signal)
			if (counts.current !== selected.length || counts.other !== 0) {
				throw new Error(
					`Index verification failed for ${filePath}: expected ${selected.length}, current ${counts.current}, other ${counts.other}`,
				)
			}
		}
		const completion = new FileCompletion(async () => {
			await this.gate.run(signal, () => this.store.deletePointsByFilePath(filePath, generation), [filePath])
			await verify()
			const waitedForPriorWrites = await this.gate.waitForPriorWrites(filePath, signal)
			if (this.gate.needsReconciliation(filePath)) {
				do {
					await this.gate.waitForGrace(filePath, signal)
					await verify()
				} while (this.gate.graceDeadline(filePath) > Date.now())
			} else if (waitedForPriorWrites) {
				await verify()
			}
			throwIfAborted(signal)
			this.cache.completeFile(filePath, hash)
			this.gate.reconciled(filePath)
			onComplete?.(selected.length)
		})
		const batches: CodeBlock[][] = []
		for (let offset = 0; offset < selected.length; offset += Math.max(1, batchSize)) {
			completion.register()
			batches.push(selected.slice(offset, offset + Math.max(1, batchSize)))
		}
		await completion.registered()
		for (const batch of batches) {
			try {
				throwIfAborted(signal)
				const { embeddings } = await embedder.createEmbeddings(
					batch.map((block) => block.content.trim()),
					undefined,
					signal,
				)
				throwIfAborted(signal)
				if (embeddings.length !== batch.length) throw new Error(`Incomplete embeddings for ${filePath}`)
				const points = batch.map((block, index) => ({
					id: uuidv5(`${block.segmentHash}:${generation}`, QDRANT_CODE_BLOCK_NAMESPACE),
					vector: embeddings[index],
					payload: {
						filePath: generateRelativeFilePath(filePath, this.workspacePath),
						codeChunk: block.content,
						startLine: block.start_line,
						endLine: block.end_line,
						segmentHash: block.segmentHash,
						generation,
					},
				}))
				await this.gate.run(signal, () => this.store.upsertPoints(points), [filePath])
			} catch (error) {
				await completion.settled(false)
				throw error
			}
			await completion.settled(true)
		}
	}
}
