import { listFiles } from "../../glob/list-files"
import { Ignore } from "ignore"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { stat } from "fs/promises"
import * as path from "path"
import { generateRelativeFilePath } from "../shared/get-relative-path"
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
import { isPathInIgnoredDirectory } from "../../glob/ignore-utils"
import { Package } from "../../../shared/package"
import { IndexWriteGate } from "../index-write-gate"
import { ParserFatalError, throwIfAborted } from "../parser-errors"
import { GenerationAllocator } from "../generation-allocator"
import { FileIndexWriter } from "../file-completion"

export class DirectoryScanner implements IDirectoryScanner {
	private readonly batchSegmentThreshold: number
	private incompleteFiles = new Set<string>()

	constructor(
		private readonly embedder: IEmbedder,
		private readonly qdrantClient: IVectorStore,
		private readonly codeParser: ICodeParser,
		private readonly cacheManager: CacheManager,
		private readonly ignoreInstance: Ignore,
		batchSegmentThreshold?: number,
		private readonly writeGate = new IndexWriteGate(),
		private readonly generations = new GenerationAllocator(cacheManager),
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
		return this.incompleteFiles.size > 0
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
		throwIfAborted(signal)
		const incompleteFiles = new Set<string>()
		this.incompleteFiles = incompleteFiles
		const scanWorkspace = getWorkspacePathForContext(directory)
		const [allPaths] = await listFiles(directory, true, MAX_LIST_FILES_LIMIT_CODE_INDEX)
		throwIfAborted(signal)
		const ignoreController = new RooIgnoreController(directory)
		await ignoreController.initialize()
		throwIfAborted(signal)
		const allowedPaths = ignoreController.filterPaths(allPaths.filter((filePath) => !filePath.endsWith("/")))
		const selectedPaths = new Set(
			allowedPaths.filter((filePath) => {
				const relativePath = generateRelativeFilePath(filePath, scanWorkspace)
				return (
					!isPathInIgnoredDirectory(relativePath) &&
					scannerExtensions.includes(path.extname(filePath).toLowerCase()) &&
					!this.ignoreInstance.ignores(relativePath)
				)
			}),
		)
		// Discovery precedes dispatch so stopping during a read or parse still reports partial work.
		for (const filePath of selectedPaths) incompleteFiles.add(filePath)
		const trackedPaths = new Set(this.cacheManager.getTrackedPaths())
		for (const filePath of trackedPaths) {
			if (!selectedPaths.has(filePath)) incompleteFiles.add(filePath)
		}

		const writer = new FileIndexWriter(
			this.cacheManager,
			this.qdrantClient,
			this.writeGate,
			this.generations,
			scanWorkspace,
		)
		let processedCount = 0
		let skippedCount = 0
		let totalBlockCount = 0
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
				if (this.cacheManager.getHash(filePath) === hash && !this.writeGate.needsReconciliation(filePath)) {
					incompleteFiles.delete(filePath)
					skippedCount++
					return
				}
				const blocks = await this.codeParser.parseFile(filePath, { content, fileHash: hash, signal })
				checkActive()
				processedCount++
				const selectedBlockCount = blocks.filter((block) => block.content.trim()).length
				onFileParsed?.(selectedBlockCount)
				if (!this.embedder || !this.qdrantClient) return
				totalBlockCount += selectedBlockCount
				await writer.replace(
					filePath,
					hash,
					blocks,
					this.embedder,
					signal,
					this.batchSegmentThreshold,
					(count) => {
						checkActive()
						incompleteFiles.delete(filePath)
						onBlocksIndexed?.(count)
					},
				)
			} catch (error) {
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

		const removedPaths = this.cacheManager.getTrackedPaths().filter((filePath) => !selectedPaths.has(filePath))
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
	}
}
