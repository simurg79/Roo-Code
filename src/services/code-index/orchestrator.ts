import * as vscode from "vscode"
import * as path from "path"
import { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager, IndexingState } from "./state-manager"
import { IFileWatcher, IVectorStore, BatchProcessingSummary } from "./interfaces"
import { DirectoryScanner } from "./processors"
import { CacheManager } from "./cache-manager"
import { t } from "../../i18n"
import { ParserFatalError, throwIfAborted } from "./parser-errors"
import { IndexWriteGate } from "./index-write-gate"
import { GenerationAllocator } from "./generation-allocator"
import { INDEX_STOP_LIMIT_MS } from "./constants"

export class CodeIndexOrchestrator {
	private _fileWatcherSubscriptions: vscode.Disposable[] = []
	private _isProcessing = false
	private _abortController: AbortController | null = null
	private scanPromise?: Promise<void>
	private stopPromise?: Promise<void>
	private readonly idleStop = Promise.resolve()
	private incompleteScan = false
	private incompleteBatch = false
	private watcherBatchPending = false
	public stopped = false
	private parserFailure?: ParserFatalError

	constructor(
		private readonly configManager: CodeIndexConfigManager,
		private readonly stateManager: CodeIndexStateManager,
		private readonly workspacePath: string,
		private readonly cacheManager: CacheManager,
		private readonly vectorStore: IVectorStore,
		private readonly scanner: DirectoryScanner,
		private readonly fileWatcher: IFileWatcher,
		private readonly parser?: { stop(): void; readonly stopped?: Promise<void>; logStopTimeout?(): void },
		private readonly onFatal?: (error: ParserFatalError, message: string) => void,
		private readonly onStopped?: () => void,
		private readonly writeGate = new IndexWriteGate(),
		private readonly generationAllocator = new GenerationAllocator(cacheManager),
		private readonly isCurrentAttempt: () => boolean = () => true,
	) {}

	private isLive(signal: AbortSignal): boolean {
		return !signal.aborted && this.isCurrentAttempt()
	}

	private failStop(error: ParserFatalError): void {
		if (this.parserFailure || this._abortController?.signal.aborted || !this.isCurrentAttempt()) return
		this.parserFailure = error
		const message = t("embeddings:orchestrator.parserFailed", {
			filePath: error.filePath,
			category: error.category,
		})
		this.stateManager.setSystemState("Error", message)
		this.onFatal?.(error, message)
		void this.stop(true)
	}

	private hasIncompleteFiles(): boolean {
		return (
			this.incompleteScan ||
			this.incompleteBatch ||
			this.watcherBatchPending ||
			this.scanner.hasIncompleteFiles ||
			Object.keys(this.cacheManager.getOpenFiles()).length > 0
		)
	}

	private async startWatcher(signal: AbortSignal): Promise<void> {
		await this.fileWatcher.initialize(signal)
		throwIfAborted(signal)
		if (!this.isCurrentAttempt()) return
		this._fileWatcherSubscriptions = [
			this.fileWatcher.onDidStartBatchProcessing(() => {
				if (!this.isLive(signal)) return
				this.watcherBatchPending = true
				this.stateManager.setSystemState("Indexing", "Processing file changes...")
			}),
			this.fileWatcher.onBatchProgressUpdate(({ processedInBatch, totalInBatch, currentFile }) => {
				if (!this.isLive(signal)) return
				this.stateManager.reportFileQueueProgress(
					processedInBatch,
					totalInBatch,
					currentFile ? path.basename(currentFile) : undefined,
				)
			}),
			this.fileWatcher.onDidFinishBatchProcessing((summary: BatchProcessingSummary) => {
				if (!this.isLive(signal)) return
				this.watcherBatchPending = false
				const incomplete =
					!!summary.batchError ||
					summary.processedFiles.some((file) => file.status !== "success" && file.status !== "skipped")
				// A later unrelated batch cannot complete files left unfinished by an earlier batch.
				this.incompleteBatch ||= incomplete
				if (this.hasIncompleteFiles()) {
					this.stateManager.setSystemState("Standby", t("embeddings:orchestrator.indexingStoppedPartial"))
				} else {
					this.stateManager.setSystemState("Indexed", t("embeddings:orchestrator.fileWatcherStarted"))
				}
			}),
		]
		if (this.fileWatcher.onParserFatal) {
			this._fileWatcherSubscriptions.push(this.fileWatcher.onParserFatal((error) => this.failStop(error)))
		}
	}

	public startIndexing(): Promise<void> {
		if (this.stopped || !this.isCurrentAttempt()) return Promise.resolve()
		if (!vscode.workspace.workspaceFolders?.length) {
			this.stateManager.setSystemState("Error", t("embeddings:orchestrator.indexingRequiresWorkspace"))
			return Promise.resolve()
		}
		if (!this.configManager.isFeatureConfigured) {
			this.stateManager.setSystemState("Standby", "Missing configuration. Save your settings to start indexing.")
			return Promise.resolve()
		}
		if (this._isProcessing) return this.scanPromise ?? Promise.resolve()
		if (this._abortController) return Promise.resolve()
		this._isProcessing = true
		this._abortController = new AbortController()
		this.stateManager.setSystemState("Indexing", "Initializing services...")
		this.scanPromise = this.runScan(this._abortController.signal)
		return this.scanPromise
	}

	private async runScan(signal: AbortSignal): Promise<void> {
		try {
			const collectionCreated = await this.writeGate.run(signal, () => this.vectorStore.initialize())
			throwIfAborted(signal)
			if (collectionCreated) await this.writeGate.run(signal, () => this.cacheManager.clearCacheFile())
			await this.generationAllocator.initialize(this.vectorStore, signal, this.writeGate)
			throwIfAborted(signal)
			if (!this.isCurrentAttempt()) return
			await this.writeGate.run(signal, () => this.vectorStore.markIndexingIncomplete())
			let blocksIndexed = 0
			let blocksFound = 0
			const batchErrors: Error[] = []
			const result = await this.scanner.scanDirectory(
				this.workspacePath,
				(error) => {
					if (this.isLive(signal)) batchErrors.push(error)
				},
				(count) => {
					if (!this.isLive(signal)) return
					blocksIndexed += count
					this.stateManager.reportBlockIndexingProgress(blocksIndexed, blocksFound)
				},
				(count) => {
					if (!this.isLive(signal)) return
					blocksFound += count
					this.stateManager.reportBlockIndexingProgress(blocksIndexed, blocksFound)
				},
				signal,
			)
			throwIfAborted(signal)
			if (!this.isCurrentAttempt()) return
			if (!result) throw new Error("Scan failed, is scanner initialized?")
			this.incompleteScan =
				batchErrors.length > 0 || !!result.incompleteFiles?.length || blocksIndexed < blocksFound
			await this.startWatcher(signal)
			throwIfAborted(signal)
			if (!this.isCurrentAttempt()) return
			if (this.hasIncompleteFiles()) {
				this.stateManager.setSystemState("Standby", t("embeddings:orchestrator.indexingStoppedPartial"))
				return
			}
			await this.writeGate.run(signal, () => this.vectorStore.markIndexingComplete())
			if (this.isLive(signal)) {
				this.stateManager.setSystemState("Indexed", t("embeddings:orchestrator.fileWatcherStarted"))
			}
		} catch (error) {
			if (!this.isLive(signal)) return
			if (error instanceof ParserFatalError) {
				this.failStop(error)
				return
			}
			if (error instanceof Error && error.name === "AbortError") {
				void this.stop(true)
				return
			}
			this.stateManager.setSystemState(
				"Error",
				t("embeddings:orchestrator.failedDuringInitialScan", {
					errorMessage: error instanceof Error ? error.message : t("embeddings:orchestrator.unknownError"),
				}),
			)
			void this.stop(true)
		} finally {
			this._isProcessing = false
		}
	}

	public stopIndexing(): Promise<void> {
		return this.stop(false)
	}

	public stopWatcher(): Promise<void> {
		return this.stop(true)
	}

	private stop(force: boolean): Promise<void> {
		if (this.stopPromise) return this.stopPromise
		const signal = this._abortController?.signal
		const active =
			this._isProcessing ||
			!!this.parserFailure ||
			this.fileWatcher.isProcessing ||
			(!!signal && this.writeGate.hasPending(signal))
		if (!active && !force) return this.idleStop
		const preserveError = this.stateManager.state === "Error" || !!this.parserFailure
		const expiresAt = Date.now() + INDEX_STOP_LIMIT_MS
		if (signal) this.writeGate.stopAt(signal, expiresAt)
		this.stopPromise = Promise.resolve().then(async () => {
			let timer: ReturnType<typeof setTimeout> | undefined
			let workerStopped = !this.parser?.stopped
			const workerExit = this.parser?.stopped?.then(() => {
				workerStopped = true
			})
			const settled = Promise.allSettled([
				this.scanPromise,
				signal ? this.writeGate.settled(signal) : undefined,
				workerExit,
			]).then(() => false)
			const expired = await Promise.race([
				settled,
				new Promise<boolean>((resolve) => {
					timer = setTimeout(() => resolve(true), Math.max(0, expiresAt - Date.now()))
				}),
			])
			clearTimeout(timer)
			if (expired && signal) this.writeGate.abandon(signal, expiresAt)
			if (expired && !workerStopped) this.parser?.logStopTimeout?.()
			if (!active || !this.isCurrentAttempt() || preserveError) return
			this.stateManager.setSystemState(
				"Standby",
				t(
					expired || this.hasIncompleteFiles()
						? "embeddings:orchestrator.indexingStoppedPartial"
						: "embeddings:orchestrator.indexingStopped",
				),
			)
		})
		this.stopped = true
		this._abortController?.abort()
		this.parser?.stop()
		this.fileWatcher.dispose()
		this._fileWatcherSubscriptions.forEach((subscription) => subscription.dispose())
		this._fileWatcherSubscriptions = []
		this.onStopped?.()
		if (active && !preserveError && this.isCurrentAttempt()) {
			this.stateManager.setSystemState("Stopping", t("embeddings:orchestrator.indexingStopping"))
		}
		return this.stopPromise
	}

	public async clearIndexData(): Promise<void> {
		await this.stopWatcher()
		const signal = new AbortController().signal
		try {
			if (this.configManager.isFeatureConfigured) {
				await this.writeGate.run(signal, () => this.vectorStore.deleteCollection())
			}
			await this.writeGate.run(signal, () => this.cacheManager.clearCacheFile())
			if (this.isCurrentAttempt()) this.stateManager.setSystemState("Standby", "Index data cleared successfully.")
		} catch (error) {
			if (this.isCurrentAttempt()) {
				this.stateManager.setSystemState("Error", `Failed to clear index data: ${String(error)}`)
			}
		}
	}

	public get state(): IndexingState {
		return this.stateManager.state
	}
}
