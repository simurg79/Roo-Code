import { listFiles } from "../../glob/list-files"
import { Ignore } from "ignore"
import { createDiscoveryContext, toIndexPath, type DiscoveryContext } from "../../glob/discovery-options"
import { isIndexDiscoveryPathEligible } from "../discovery"
import { stat } from "fs/promises"
import * as path from "path"
import { getWorkspacePathForContext } from "../../../utils/path"
import { scannerExtensions } from "../shared/supported-extensions"
import * as vscode from "vscode"
import { ICodeParser, IEmbedder, IVectorStore, IDirectoryScanner } from "../interfaces"
import { createHash } from "crypto"
import { CacheManager } from "../cache-manager"
import {
	MAX_FILE_SIZE_BYTES,
	MAX_LIST_FILES_LIMIT_CODE_INDEX,
	BATCH_SEGMENT_THRESHOLD,
	PARSING_CONCURRENCY,
	BATCH_PROCESSING_CONCURRENCY,
} from "../constants"
import { Package } from "../../../shared/package"
import { IndexWriteGate } from "../index-write-gate"
import { ParserFatalError, throwIfAborted } from "../parser-errors"
import { GenerationAllocator } from "../generation-allocator"
import { FileIndexWriter } from "../file-completion"
import { FileFailureRegistry, UNKNOWN_REVISION, type FileFailureActivity } from "../file-failure-registry"
import { codeIndexLog } from "../code-index-log"
import { ProviderPacerRegistry } from "../provider-pacer"

export class DirectoryScanner implements IDirectoryScanner {
	private readonly batchSegmentThreshold: number
	private incompleteFiles = new Set<string>()

	private discoveryContext?: Promise<DiscoveryContext>

	constructor(
		private readonly embedder: IEmbedder,
		private readonly qdrantClient: IVectorStore,
		private readonly codeParser: ICodeParser,
		private readonly cacheManager: CacheManager,
		private readonly ignoreInstance: Ignore,
		batchSegmentThreshold?: number,
		private readonly writeGate = new IndexWriteGate(),
		private readonly generations = new GenerationAllocator(cacheManager),
		private readonly failures = new FileFailureRegistry(),
		private readonly getDiscoveryContext?: () => Promise<DiscoveryContext>,
		private readonly pacers = new ProviderPacerRegistry(),
	) {
		if (batchSegmentThreshold !== undefined) {
			this.batchSegmentThreshold = batchSegmentThreshold
		} else {
			try {
				this.batchSegmentThreshold = vscode.workspace
					.getConfiguration(Package.name)
					.get<number>("codeIndex.embeddingBatchSize", BATCH_SEGMENT_THRESHOLD)
			} catch {
				this.batchSegmentThreshold = BATCH_SEGMENT_THRESHOLD
			}
		}
	}

	public get hasIncompleteFiles(): boolean {
		return this.incompleteFiles.size > 0 || this.failures.list().length > 0
	}

	public async scanDirectory(
		directory: string,
		onError?: (error: Error) => void,
		onBlocksIndexed?: (indexedCount: number) => void,
		onFileParsed?: (fileBlockCount: number) => void,
		signal = new AbortController().signal,
	): Promise<{
		stats: { processed: number; skipped: number }
		totalBlockCount: number
		incompleteFiles?: string[]
	}> {
		const startedAt = Date.now()
		let processedCount = 0
		let skippedCount = 0
		let totalBlockCount = 0
		let indexedBlockCount = 0
		let partialReason: string | undefined
		const failureBatch = codeIndexLog.createFailureBatch({ source: "scan" })
		const subscription = this.failures.onDidRecord((failure) =>
			failureBatch.record({ ...failure, willRetry: failure.state === "retrying" }),
		)
		try {
			throwIfAborted(signal)
			const incompleteFiles = new Set<string>()
			this.incompleteFiles = incompleteFiles
			const scanWorkspace = getWorkspacePathForContext(directory)
			this.discoveryContext ??= this.getDiscoveryContext?.() ?? createDiscoveryContext(scanWorkspace)
			const discoveryContext = await this.discoveryContext
			throwIfAborted(signal)
			const [allPaths, , blockedPaths] = await listFiles(
				directory,
				true,
				MAX_LIST_FILES_LIMIT_CODE_INDEX,
				discoveryContext,
			)
			throwIfAborted(signal)
			const selectedPaths = new Set(
				allPaths.filter(
					(filePath) =>
						!filePath.endsWith("/") &&
						scannerExtensions.includes(path.extname(filePath).toLowerCase()) &&
						isIndexDiscoveryPathEligible(
							filePath,
							discoveryContext,
							this.ignoreInstance,
							blockedPaths?.length === 0,
						),
				),
			)
			// Discovery precedes dispatch so stopping during a read or parse still reports partial work.
			for (const filePath of selectedPaths) incompleteFiles.add(filePath)
			const trackedPaths = new Set([
				...this.cacheManager.getTrackedPaths(),
				...this.failures.list().map((failure) => path.resolve(scanWorkspace, failure.path)),
			])
			for (const filePath of trackedPaths) {
				if (!selectedPaths.has(filePath)) incompleteFiles.add(filePath)
			}

			const writer = new FileIndexWriter(
				this.cacheManager,
				this.qdrantClient,
				this.writeGate,
				this.generations,
				scanWorkspace,
				this.failures,
				this.pacers,
			)
			let fatalError: ParserFatalError | undefined
			const checkActive = () => {
				if (fatalError) throw fatalError
				throwIfAborted(signal)
			}
			const reportError = (error: unknown, filePath: string) => {
				if (error instanceof ParserFatalError) {
					fatalError ??= error
					throw fatalError
				}
				checkActive()
				if (error instanceof Error && error.name === "AbortError") throw error
				const message = error instanceof Error ? error.message : String(error)
				onError?.(new Error(`${message} (Workspace: ${scanWorkspace}, File: ${filePath})`))
			}
			const processFile = async (filePath: string) => {
				const relativePath = toIndexPath(filePath, scanWorkspace)
				let revision = this.failures.getRevision(relativePath) ?? UNKNOWN_REVISION
				this.failures.renew(relativePath, revision)
				let activity: FileFailureActivity = "read"
				let fileSignal = signal
				try {
					checkActive()
					const stats = await stat(filePath)
					checkActive()
					if (stats.size > MAX_FILE_SIZE_BYTES) {
						selectedPaths.delete(filePath)
						if (!trackedPaths.has(filePath)) incompleteFiles.delete(filePath)
						skippedCount++
						return
					}
					const buffer = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
					checkActive()
					const content = Buffer.from(buffer).toString("utf-8")
					const hash = createHash("sha256").update(content).digest("hex")
					revision = hash
					fileSignal = AbortSignal.any([signal, this.failures.renew(relativePath, hash)])
					this.writeGate.own(fileSignal, signal)
					if (
						this.cacheManager.getHash(filePath) === hash &&
						!this.writeGate.needsReconciliation(filePath) &&
						!this.failures.has(relativePath)
					) {
						incompleteFiles.delete(filePath)
						skippedCount++
						return
					}
					activity = "embed"
					this.failures.assertRetryable(relativePath, hash)
					activity = "parse"
					const blocks = await this.codeParser.parseFile(filePath, {
						content,
						fileHash: hash,
						signal: fileSignal,
					})
					throwIfAborted(fileSignal)
					checkActive()
					processedCount++
					const selectedBlockCount = blocks.filter((block) => block.content.trim()).length
					onFileParsed?.(selectedBlockCount)
					if (!this.embedder || !this.qdrantClient) return
					totalBlockCount += selectedBlockCount
					activity = "embed"
					await writer.replace(
						filePath,
						hash,
						blocks,
						this.embedder,
						fileSignal,
						this.batchSegmentThreshold,
						(count) => {
							checkActive()
							incompleteFiles.delete(filePath)
							indexedBlockCount += count
							onBlocksIndexed?.(count)
						},
						signal,
					)
				} catch (error) {
					if (
						(activity === "read" || activity === "parse") &&
						!fileSignal.aborted &&
						!(error instanceof Error && error.name === "AbortError")
					) {
						this.failures.record(
							relativePath,
							revision,
							activity,
							error instanceof Error ? error.message : String(error),
							1,
							"exhausted",
						)
					}
					if (fileSignal.aborted && !signal.aborted) return
					reportError(error, filePath)
				}
			}
			const processPaths = async (paths: string[], process: (filePath: string) => Promise<void>) => {
				let nextPath = 0
				const worker = async () => {
					while (nextPath < paths.length) {
						checkActive()
						const filePath = paths[nextPath++]
						await process(filePath)
					}
				}
				const concurrency = Math.min(PARSING_CONCURRENCY, BATCH_PROCESSING_CONCURRENCY, paths.length)
				await Promise.all(Array.from({ length: concurrency }, worker))
			}
			await processPaths([...selectedPaths], processFile)
			checkActive()

			const removedPaths = [...new Set([...trackedPaths, ...this.cacheManager.getTrackedPaths()])].filter(
				(filePath) => !selectedPaths.has(filePath),
			)
			for (const filePath of removedPaths) incompleteFiles.add(filePath)
			await processPaths(removedPaths, async (filePath) => {
				try {
					checkActive()
					if (!this.qdrantClient) return
					await writer.remove(filePath, signal)
					checkActive()
					incompleteFiles.delete(filePath)
				} catch (error) {
					reportError(error, filePath)
				}
			})
			checkActive()
			return {
				stats: { processed: processedCount, skipped: skippedCount },
				totalBlockCount,
				incompleteFiles: [...incompleteFiles],
			}
		} catch (error) {
			partialReason = error instanceof Error ? error.message : String(error)
			throw error
		} finally {
			subscription.dispose()
			failureBatch.flush()
			codeIndexLog.info("Scan summary", {
				processed: processedCount,
				skipped: skippedCount,
				failed: this.failures.list().length,
				blocksFound: totalBlockCount,
				blocksIndexed: indexedBlockCount,
				elapsedMs: Date.now() - startedAt,
				partialReason: partialReason ?? (this.hasIncompleteFiles ? "Unresolved files" : undefined),
			})
		}
	}
}
