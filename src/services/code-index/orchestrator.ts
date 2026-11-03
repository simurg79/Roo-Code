import * as vscode from "vscode"
import * as path from "path"
import { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager, IndexingState } from "./state-manager"
import { IFileWatcher, IVectorStore } from "./interfaces"
import { DirectoryScanner } from "./processors"
import { CacheManager } from "./cache-manager"
import { t } from "../../i18n"
import { ParserFatalError, throwIfAborted } from "./parser-errors"
import { IndexWriteGate } from "./index-write-gate"
import { GenerationAllocator } from "./generation-allocator"
import { INDEX_STOP_LIMIT_MS } from "./constants"

import { FileFailureRegistry } from "./file-failure-registry"
import { codeIndexLog } from "./code-index-log"

export class CodeIndexOrchestrator {
	private _fileWatcherSubscriptions: vscode.Disposable[] = []
	private _isProcessing = false
	private _abortController: AbortController | null = null
	private scanPromise?: Promise<void>
	private stopPromise?: Promise<void>
	private readonly idleStop = Promise.resolve()
	public startupResult: Promise<void> = Promise.resolve()
	private resolveStartup?: () => void
	private rejectStartup?: (error: unknown) => void
	private failureSubscription?: vscode.Disposable
	private watcherBatchPending = false
	public stopped = false
	private parserFailure?: ParserFatalError
	private collectionIncomplete = false
	private recoveryCompletion?: Promise<void>

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
		private readonly failures = new FileFailureRegistry(),
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
		this.stateManager.setSystemState("Error", message, "error")
		this.onFatal?.(error, message)
		void this.stop(true)
	}

	private hasIncompleteFiles(): boolean {
		return (
			this.failures.list().length > 0 ||
			this.watcherBatchPending ||
			(this.stopped && this.scanner.hasIncompleteFiles) ||
			Object.keys(this.cacheManager.getOpenFiles()).length > 0
		)
	}

	private updateRecoveryStatus(
		signal: AbortSignal,
		source = this._isProcessing ? "scan" : "changed-file-batch",
	): void {
		if (!this.isLive(signal) || this.stopped || this.stateManager.state === "Error") return
		const failures = this.failures.list()
		const retrying = failures.some((failure) => failure.state === "retrying")
		const recoveryMessage = t(
			retrying ? "embeddings:orchestrator.indexingFilesRetrying" : "embeddings:orchestrator.indexingFilesFailed",
		)
		if (this._isProcessing || this.watcherBatchPending || retrying) {
			this.stateManager.setSystemState("Indexing", failures.length > 0 ? recoveryMessage : undefined, source)
		} else if (this.hasIncompleteFiles()) {
			this.stateManager.setSystemState("Standby", recoveryMessage, source)
		} else if (this.collectionIncomplete) {
			this.recoveryCompletion ??= this.completeRecovery(signal, source).finally(() => {
				this.recoveryCompletion = undefined
			})
		} else {
			this.stateManager.setSystemState("Indexed", t("embeddings:orchestrator.fileWatcherStarted"), source)
		}
	}

	private async completeRecovery(signal: AbortSignal, source: string): Promise<void> {
		try {
			await this.writeGate.run(signal, async () => {
				if (
					!this.isLive(signal) ||
					this.stopped ||
					this.stateManager.state === "Error" ||
					this.hasIncompleteFiles() ||
					this._isProcessing
				)
					return
				await this.vectorStore.markIndexingComplete()
				this.collectionIncomplete = false
			})
			if (this.isLive(signal) && !this.collectionIncomplete) this.updateRecoveryStatus(signal, source)
		} catch (error) {
			if (!this.isLive(signal) || this.stopped) return
			codeIndexLog.error("Recovery completion failed", { error })
			this.stateManager.setSystemState("Error", String(error), "error")
		}
	}

	private async startWatcher(signal: AbortSignal): Promise<void> {
		await this.fileWatcher.initialize(signal)
		throwIfAborted(signal)
		if (!this.isCurrentAttempt()) return
		this._fileWatcherSubscriptions = [
			this.fileWatcher.onDidStartBatchProcessing(() => {
				if (!this.isLive(signal)) return
				this.watcherBatchPending = true
				this.stateManager.setSystemState("Indexing", "Processing file changes...", "changed-file-batch")
			}),
			this.fileWatcher.onBatchProgressUpdate(({ processedInBatch, totalInBatch, currentFile }) => {
				if (!this.isLive(signal)) return
				this.stateManager.reportFileQueueProgress(
					processedInBatch,
					totalInBatch,
					currentFile ? path.basename(currentFile) : undefined,
					"changed-file-batch",
				)
			}),
			this.fileWatcher.onDidFinishBatchProcessing(() => {
				if (!this.isLive(signal)) return
				this.watcherBatchPending = false
				this.updateRecoveryStatus(signal, "changed-file-batch")
			}),
		]
		if (this.fileWatcher.onParserFatal) {
			this._fileWatcherSubscriptions.push(this.fileWatcher.onParserFatal((error) => this.failStop(error)))
		}
	}

	public startIndexing(): Promise<void> {
		if (this.stopped || !this.isCurrentAttempt()) return Promise.resolve()
		if (!vscode.workspace.workspaceFolders?.length) {
			const message = t("embeddings:orchestrator.indexingRequiresWorkspace")
			this.stateManager.setSystemState("Error", message, "error")
			this.startupResult = Promise.reject(new Error(message))
			void this.startupResult.catch(() => {})
			return Promise.resolve()
		}
		if (!this.configManager.isFeatureConfigured) {
			this.stateManager.setSystemState(
				"Standby",
				"Missing configuration. Save your settings to start indexing.",
				"start-request",
			)
			return Promise.resolve()
		}
		if (this._isProcessing) return this.scanPromise ?? Promise.resolve()
		if (this._abortController) return Promise.resolve()
		this._isProcessing = true
		this._abortController = new AbortController()
		this.startupResult = new Promise<void>((resolve, reject) => {
			this.resolveStartup = resolve
			this.rejectStartup = reject
		})
		void this.startupResult.catch(() => {})
		const signal = this._abortController.signal
		this.failureSubscription = this.failures.onDidChange(() => this.updateRecoveryStatus(signal))
		this.stateManager.setSystemState("Indexing", "Initializing services...", "start-request")
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
			this.collectionIncomplete = true
			this.resolveStartup?.()
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
					this.stateManager.reportBlockIndexingProgress(blocksIndexed, blocksFound, "scan")
				},
				(count) => {
					if (!this.isLive(signal)) return
					blocksFound += count
					this.stateManager.reportBlockIndexingProgress(blocksIndexed, blocksFound, "scan")
				},
				signal,
			)
			throwIfAborted(signal)
			if (!this.isCurrentAttempt()) return
			if (!result) throw new Error("Scan failed, is scanner initialized?")
			codeIndexLog.info("Scan summary", {
				blocksIndexed,
				blocksFound,
				failureCount: batchErrors.length,
				incompleteFiles: result.incompleteFiles,
			})
			await this.startWatcher(signal)
			throwIfAborted(signal)
			if (!this.isCurrentAttempt()) return
			if (this.hasIncompleteFiles()) {
				this.updateRecoveryStatus(signal, "scan-end")
				return
			}
			await this.writeGate.run(signal, () => this.vectorStore.markIndexingComplete())
			this.collectionIncomplete = false
			if (this.isLive(signal)) {
				this.stateManager.setSystemState("Indexed", t("embeddings:orchestrator.fileWatcherStarted"), "scan-end")
			}
		} catch (error) {
			this.rejectStartup?.(error)
			if (!this.isLive(signal)) return
			if (error instanceof ParserFatalError) {
				this.failStop(error)
				return
			}
			if (error instanceof Error && error.name === "AbortError") {
				void this.stop(true)
				return
			}
			codeIndexLog.error("Initial scan failed", { error })
			this.stateManager.setSystemState(
				"Error",
				t("embeddings:orchestrator.failedDuringInitialScan", {
					errorMessage: error instanceof Error ? error.message : t("embeddings:orchestrator.unknownError"),
				}),
				"error",
			)
			void this.stop(true)
		} finally {
			this.resolveStartup?.()
			this._isProcessing = false
			this.updateRecoveryStatus(signal, "scan-end")
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
				"stop",
			)
		})
		this.stopped = true
		this._abortController?.abort()
		this.resolveStartup?.()
		this.failureSubscription?.dispose()
		this.failureSubscription = undefined
		this.parser?.stop()
		this.fileWatcher.dispose()
		this._fileWatcherSubscriptions.forEach((subscription) => subscription.dispose())
		this._fileWatcherSubscriptions = []
		this.onStopped?.()
		if (active && !preserveError && this.isCurrentAttempt()) {
			this.stateManager.setSystemState("Stopping", t("embeddings:orchestrator.indexingStopping"), "stop")
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
			if (this.isCurrentAttempt())
				this.stateManager.setSystemState("Standby", "Index data cleared successfully.", "rebuild")
		} catch (error) {
			if (this.isCurrentAttempt()) {
				this.stateManager.setSystemState("Error", `Failed to clear index data: ${String(error)}`, "error")
			}
		}
	}

	public get isScanning(): boolean {
		return this._isProcessing
	}

	public get isActive(): boolean {
		return this._isProcessing || this.watcherBatchPending
	}

	public get state(): IndexingState {
		return this.stateManager.state
	}
}
