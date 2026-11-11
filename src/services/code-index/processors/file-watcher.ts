import * as vscode from "vscode"
import { MAX_FILE_SIZE_BYTES, BATCH_SEGMENT_THRESHOLD } from "../constants"
import { createHash } from "crypto"
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
import { createDiscoveryContext, toIndexPath, type DiscoveryContext } from "../../glob/discovery-options"
import { findStartupDirectoryLinks, isIndexDiscoveryPathEligible } from "../discovery"
import * as path from "path"
import { Package } from "../../../shared/package"
import { FileFailureRegistry, UNKNOWN_REVISION, type FileFailureActivity } from "../file-failure-registry"
import { codeIndexLog } from "../code-index-log"
import { ProviderPacerRegistry } from "../provider-pacer"

type FileEvent = { uri: vscode.Uri; type: "create" | "change" | "delete" }

export class FileWatcher implements IFileWatcher {
	private readonly fileWatchers: vscode.FileSystemWatcher[] = []
	private discoveryContext?: Promise<DiscoveryContext>
	private readonly accumulatedEvents = new Map<string, FileEvent>()
	private batchProcessDebounceTimer?: NodeJS.Timeout
	private readonly BATCH_DEBOUNCE_DELAY_MS = 500
	private readonly FILE_PROCESSING_CONCURRENCY_LIMIT = 10
	private readonly batchSegmentThreshold: number
	private readonly writer?: FileIndexWriter
	private readonly pathControllers = new Map<string, AbortController>()
	private readonly localAbortController = new AbortController()
	private signal = this.localAbortController.signal
	private attemptOwner = this.localAbortController.signal
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
		batchSegmentThreshold?: number,
		private readonly parser: ICodeParser = new ParseWorkerClient(),
		private readonly writeGate = new IndexWriteGate(),
		private readonly generations = new GenerationAllocator(cacheManager),
		private readonly failures = new FileFailureRegistry(),
		private readonly getDiscoveryContext?: () => Promise<DiscoveryContext>,
		private readonly pacers = new ProviderPacerRegistry(),
	) {
		if (vectorStore) {
			this.writer = new FileIndexWriter(
				cacheManager,
				vectorStore,
				writeGate,
				generations,
				workspacePath,
				failures,
				pacers,
			)
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
		this.attemptOwner = signal ?? this.localAbortController.signal
		this.signal = signal
			? AbortSignal.any([signal, this.localAbortController.signal])
			: this.localAbortController.signal
		if (signal) this.writeGate.own(this.signal, signal)
		throwIfAborted(this.signal)
		const discoveryContext = await this.getContext()
		const links = await findStartupDirectoryLinks(discoveryContext, this.ignoreInstance, this.signal)
		throwIfAborted(this.signal)
		for (const root of [this.workspacePath, ...discoveryContext.includedRoots.map((root) => root.root), ...links]) {
			const filePattern = new vscode.RelativePattern(
				root,
				`**/*{${scannerExtensions.map((extension) => extension.substring(1)).join(",")}}`,
			)
			const watcher = vscode.workspace.createFileSystemWatcher(filePattern)
			this.fileWatchers.push(watcher)
			watcher.onDidCreate((uri) => this.handleFileEvent(uri, "create"))
			watcher.onDidChange((uri) => this.handleFileEvent(uri, "change"))
			watcher.onDidDelete((uri) => this.handleFileEvent(uri, "delete"))
		}
	}

	private getContext(): Promise<DiscoveryContext> {
		return (this.discoveryContext ??= this.getDiscoveryContext?.() ?? createDiscoveryContext(this.workspacePath))
	}

	dispose(): void {
		if (this.disposed) return
		this.disposed = true
		this.localAbortController.abort()
		this.parserFatal.dispose()
		for (const watcher of this.fileWatchers) watcher.dispose()
		clearTimeout(this.batchProcessDebounceTimer)
		this._onDidStartBatchProcessing.dispose()
		this._onBatchProgressUpdate.dispose()
		this._onDidFinishBatchProcessing.dispose()
		this.accumulatedEvents.clear()
	}

	private handleFileEvent(uri: vscode.Uri, type: FileEvent["type"]): void {
		if (this.disposed || this.signal.aborted) return
		this.pathControllers.get(uri.fsPath)?.abort()
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
		const failureBatch = codeIndexLog.createFailureBatch({ source: "watcher" })
		const subscription = this.failures.onDidRecord((failure) =>
			failureBatch.record({ ...failure, willRetry: failure.state === "retrying" }),
		)
		try {
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
		} finally {
			subscription.dispose()
			failureBatch.flush()
		}
	}

	private reportFatal(error: ParserFatalError): void {
		if (this.fatalReported || this.disposed || this.signal.aborted) return
		this.fatalReported = true
		this.parserFatal.fire(error)
		this.dispose()
	}

	private async removeFile(filePath: string, signal = this.signal): Promise<FileProcessingResult> {
		const controller = signal === this.signal ? new AbortController() : undefined
		if (controller) {
			this.pathControllers.get(filePath)?.abort()
			this.pathControllers.set(filePath, controller)
			signal = AbortSignal.any([signal, controller.signal])
		}
		try {
			throwIfAborted(signal)
			if (
				!this.cacheManager.isTracked(filePath) &&
				!this.failures.has(toIndexPath(filePath, this.workspacePath))
			) {
				return { path: filePath, status: "skipped", reason: "File is not tracked" }
			}
			if (!this.writer) throw new Error("Vector store is not configured")
			await this.writer.remove(filePath, signal, this.attemptOwner)
			return { path: filePath, status: "success" }
		} catch (error) {
			if (signal.aborted && !this.signal.aborted)
				return { path: filePath, status: "local_error", error: error as Error }
			if (this.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error
			return { path: filePath, status: "local_error", error: error as Error }
		} finally {
			if (controller && this.pathControllers.get(filePath) === controller) this.pathControllers.delete(filePath)
		}
	}

	async processFile(filePath: string): Promise<FileProcessingResult> {
		this.activeFiles++
		this.pathControllers.get(filePath)?.abort()
		const controller = new AbortController()
		this.pathControllers.set(filePath, controller)
		let signal = AbortSignal.any([this.signal, controller.signal])
		const relativeFilePath = toIndexPath(filePath, this.workspacePath)
		let revision = this.failures.getRevision(relativeFilePath) ?? UNKNOWN_REVISION
		this.failures.renew(relativeFilePath, revision)
		let activity: FileFailureActivity = "read"
		try {
			throwIfAborted(signal)
			const discoveryContext = await this.getContext()
			throwIfAborted(signal)
			if (
				!scannerExtensions.includes(path.extname(filePath).toLowerCase()) ||
				!isIndexDiscoveryPathEligible(filePath, discoveryContext, this.ignoreInstance)
			) {
				return await this.removeFile(filePath, signal)
			}
			const fileStat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
			throwIfAborted(signal)
			if (fileStat.size > MAX_FILE_SIZE_BYTES) {
				return await this.removeFile(filePath, signal)
			}
			const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
			throwIfAborted(signal)
			const content = Buffer.from(fileContent).toString("utf8")
			const newHash = createHash("sha256").update(content).digest("hex")
			revision = newHash
			signal = AbortSignal.any([signal, this.failures.renew(relativeFilePath, newHash)])
			this.writeGate.own(signal, this.signal)
			if (
				this.cacheManager.getHash(filePath) === newHash &&
				!this.writeGate.needsReconciliation(filePath) &&
				!this.failures.has(relativeFilePath)
			) {
				return { path: filePath, status: "skipped", reason: "File has not changed" }
			}
			if (!this.writer || !this.embedder) throw new Error("Indexing services are not configured")
			activity = "embed"
			this.failures.assertRetryable(relativeFilePath, revision)
			activity = "parse"
			const blocks = await this.parser.parseFile(filePath, { content, fileHash: newHash, signal })
			throwIfAborted(signal)
			activity = "embed"
			await this.writer.replace(
				filePath,
				newHash,
				blocks,
				this.embedder,
				signal,
				this.batchSegmentThreshold,
				undefined,
				this.attemptOwner,
			)
			throwIfAborted(signal)
			return { path: filePath, status: "success" }
		} catch (error) {
			if (
				(activity === "read" || activity === "parse") &&
				!signal.aborted &&
				!(error instanceof Error && error.name === "AbortError")
			) {
				this.failures.record(
					relativeFilePath,
					revision,
					activity,
					error instanceof Error ? error.message : String(error),
					1,
					"exhausted",
				)
			}
			if (signal.aborted && !this.signal.aborted)
				return { path: filePath, status: "local_error", error: error as Error }
			if (error instanceof ParserFatalError) {
				this.reportFatal(error)
				throw error
			}
			if (this.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error
			return { path: filePath, status: "local_error", error: error as Error }
		} finally {
			if (this.pathControllers.get(filePath) === controller) this.pathControllers.delete(filePath)
			this.activeFiles--
		}
	}
}
