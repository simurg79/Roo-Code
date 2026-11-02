import * as vscode from "vscode"
import { MAX_FILE_SIZE_BYTES, BATCH_SEGMENT_THRESHOLD } from "../constants"
import { createHash } from "crypto"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"
import { Ignore } from "ignore"
import { scannerExtensions } from "../shared/supported-extensions"
import { IFileWatcher, FileProcessingResult, IEmbedder, IVectorStore, BatchProcessingSummary } from "../interfaces"
import { ParseWorkerClient } from "../parse-worker-client"
import type { ICodeParser } from "../interfaces"
import { IndexWriteGate } from "../index-write-gate"
import { GenerationAllocator } from "../generation-allocator"
import { FileIndexWriter } from "../file-completion"
import { ParserFatalError, throwIfAborted } from "../parser-errors"
import { CacheManager } from "../cache-manager"
import { generateRelativeFilePath } from "../shared/get-relative-path"
import { isPathInIgnoredDirectory } from "../../glob/ignore-utils"
import { Package } from "../../../shared/package"

type FileEvent = { uri: vscode.Uri; type: "create" | "change" | "delete" }

export class FileWatcher implements IFileWatcher {
	private fileWatcher?: vscode.FileSystemWatcher
	private readonly ignoreController: RooIgnoreController
	private readonly accumulatedEvents = new Map<string, FileEvent>()
	private batchProcessDebounceTimer?: NodeJS.Timeout
	private readonly BATCH_DEBOUNCE_DELAY_MS = 500
	private readonly FILE_PROCESSING_CONCURRENCY_LIMIT = 10
	private readonly batchSegmentThreshold: number
	private readonly writer?: FileIndexWriter
	private readonly localAbortController = new AbortController()
	private signal = this.localAbortController.signal
	private processingBatch = false
	private activeFiles = 0
	private disposed = false
	private fatalReported = false
	private readonly parserFatal = new vscode.EventEmitter<ParserFatalError>()
	public readonly onParserFatal = this.parserFatal.event
	private readonly _onDidStartBatchProcessing = new vscode.EventEmitter<string[]>()
	private readonly _onBatchProgressUpdate = new vscode.EventEmitter<{
		processedInBatch: number
		totalInBatch: number
		currentFile?: string
	}>()
	private readonly _onDidFinishBatchProcessing = new vscode.EventEmitter<BatchProcessingSummary>()
	public readonly onDidStartBatchProcessing = this._onDidStartBatchProcessing.event
	public readonly onBatchProgressUpdate = this._onBatchProgressUpdate.event
	public readonly onDidFinishBatchProcessing = this._onDidFinishBatchProcessing.event

	constructor(
		private readonly workspacePath: string,
		private readonly context: vscode.ExtensionContext,
		private readonly cacheManager: CacheManager,
		private readonly embedder?: IEmbedder,
		private readonly vectorStore?: IVectorStore,
		private readonly ignoreInstance?: Ignore,
		ignoreController?: RooIgnoreController,
		batchSegmentThreshold?: number,
		private readonly parser: ICodeParser = new ParseWorkerClient(),
		private readonly writeGate = new IndexWriteGate(),
		private readonly generations = new GenerationAllocator(cacheManager),
	) {
		this.ignoreController = ignoreController || new RooIgnoreController(workspacePath)
		if (vectorStore) {
			this.writer = new FileIndexWriter(cacheManager, vectorStore, writeGate, generations, workspacePath)
		}
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

	public get isProcessing(): boolean {
		return this.processingBatch || this.activeFiles > 0
	}

	async initialize(signal?: AbortSignal): Promise<void> {
		if (this.disposed) throw new DOMException("Indexing aborted", "AbortError")
		this.signal = signal
			? AbortSignal.any([signal, this.localAbortController.signal])
			: this.localAbortController.signal
		if (signal) this.writeGate.own(this.signal, signal)
		throwIfAborted(this.signal)
		const filePattern = new vscode.RelativePattern(
			this.workspacePath,
			`**/*{${scannerExtensions.map((extension) => extension.substring(1)).join(",")}}`,
		)
		this.fileWatcher = vscode.workspace.createFileSystemWatcher(filePattern)
		this.fileWatcher.onDidCreate((uri) => this.handleFileEvent(uri, "create"))
		this.fileWatcher.onDidChange((uri) => this.handleFileEvent(uri, "change"))
		this.fileWatcher.onDidDelete((uri) => this.handleFileEvent(uri, "delete"))
	}

	dispose(): void {
		if (this.disposed) return
		this.disposed = true
		this.localAbortController.abort()
		this.parserFatal.dispose()
		this.fileWatcher?.dispose()
		clearTimeout(this.batchProcessDebounceTimer)
		this._onDidStartBatchProcessing.dispose()
		this._onBatchProgressUpdate.dispose()
		this._onDidFinishBatchProcessing.dispose()
		this.accumulatedEvents.clear()
	}

	private handleFileEvent(uri: vscode.Uri, type: FileEvent["type"]): void {
		if (this.disposed || this.signal.aborted) return
		this.accumulatedEvents.set(uri.fsPath, { uri, type })
		this.scheduleBatchProcessing()
	}

	private scheduleBatchProcessing(): void {
		if (this.disposed || this.signal.aborted) return
		clearTimeout(this.batchProcessDebounceTimer)
		this.batchProcessDebounceTimer = setTimeout(
			() => void this.triggerBatchProcessing(),
			this.BATCH_DEBOUNCE_DELAY_MS,
		)
	}

	private async triggerBatchProcessing(): Promise<void> {
		if (this.disposed || this.signal.aborted || this.processingBatch || this.accumulatedEvents.size === 0) return
		const eventsToProcess = new Map(this.accumulatedEvents)
		this.accumulatedEvents.clear()
		this.processingBatch = true
		try {
			this._onDidStartBatchProcessing.fire([...eventsToProcess.keys()])
			await this.processBatch(eventsToProcess)
		} catch (error) {
			if (error instanceof ParserFatalError) this.reportFatal(error)
			else if (!this.signal.aborted && !this.disposed) {
				this._onDidFinishBatchProcessing.fire({ processedFiles: [], batchError: error as Error })
			}
		} finally {
			this.processingBatch = false
			if (this.accumulatedEvents.size > 0) this.scheduleBatchProcessing()
		}
	}

	private async processBatch(eventsToProcess: Map<string, FileEvent>): Promise<void> {
		throwIfAborted(this.signal)
		const events = [...eventsToProcess.values()]
		const results: FileProcessingResult[] = []
		let nextEvent = 0
		let completed = 0
		this._onBatchProgressUpdate.fire({ processedInBatch: 0, totalInBatch: events.length })
		const processNext = async () => {
			while (nextEvent < events.length) {
				throwIfAborted(this.signal)
				const event = events[nextEvent++]
				const result =
					event.type === "delete"
						? await this.removeFile(event.uri.fsPath)
						: await this.processFile(event.uri.fsPath)
				throwIfAborted(this.signal)
				results.push(result)
				if (result.status === "success" || result.status === "skipped") {
					completed++
					this._onBatchProgressUpdate.fire({
						processedInBatch: completed,
						totalInBatch: events.length,
						currentFile: result.path,
					})
				}
			}
		}
		// Each worker completes its file before taking another; no file waits for a batch-wide flush.
		await Promise.all(
			Array.from({ length: Math.min(events.length, this.FILE_PROCESSING_CONCURRENCY_LIMIT) }, processNext),
		)
		throwIfAborted(this.signal)
		const errors = results.filter((result) => result.status === "local_error")
		this._onDidFinishBatchProcessing.fire({
			processedFiles: results,
			batchError: errors.length ? new Error(`${errors.length} file changes could not be indexed`) : undefined,
		})
	}

	private reportFatal(error: ParserFatalError): void {
		if (this.fatalReported || this.disposed || this.signal.aborted) return
		this.fatalReported = true
		this.parserFatal.fire(error)
		this.dispose()
	}

	private async removeFile(filePath: string): Promise<FileProcessingResult> {
		try {
			throwIfAborted(this.signal)
			if (!this.cacheManager.isTracked(filePath)) {
				return { path: filePath, status: "skipped", reason: "File is not tracked" }
			}
			if (!this.writer) throw new Error("Vector store is not configured")
			await this.writer.remove(filePath, this.signal)
			return { path: filePath, status: "success" }
		} catch (error) {
			if (this.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error
			return { path: filePath, status: "local_error", error: error as Error }
		}
	}

	async processFile(filePath: string): Promise<FileProcessingResult> {
		this.activeFiles++
		try {
			throwIfAborted(this.signal)
			const relativeFilePath = generateRelativeFilePath(filePath, this.workspacePath)
			if (
				isPathInIgnoredDirectory(relativeFilePath) ||
				!this.ignoreController.validateAccess(filePath) ||
				this.ignoreInstance?.ignores(relativeFilePath)
			) {
				return await this.removeFile(filePath)
			}
			const fileStat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
			throwIfAborted(this.signal)
			if (fileStat.size > MAX_FILE_SIZE_BYTES) {
				return await this.removeFile(filePath)
			}
			const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
			throwIfAborted(this.signal)
			const content = Buffer.from(fileContent).toString("utf8")
			const newHash = createHash("sha256").update(content).digest("hex")
			if (this.cacheManager.getHash(filePath) === newHash && !this.writeGate.needsReconciliation(filePath)) {
				return { path: filePath, status: "skipped", reason: "File has not changed" }
			}
			if (!this.writer || !this.embedder) throw new Error("Indexing services are not configured")
			const blocks = await this.parser.parseFile(filePath, { content, fileHash: newHash, signal: this.signal })
			throwIfAborted(this.signal)
			await this.writer.replace(filePath, newHash, blocks, this.embedder, this.signal, this.batchSegmentThreshold)
			throwIfAborted(this.signal)
			return { path: filePath, status: "success" }
		} catch (error) {
			if (error instanceof ParserFatalError) {
				this.reportFatal(error)
				throw error
			}
			if (this.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error
			return { path: filePath, status: "local_error", error: error as Error }
		} finally {
			this.activeFiles--
		}
	}
}
