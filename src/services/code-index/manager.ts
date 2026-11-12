import * as vscode from "vscode"
import { ContextProxy } from "../../core/config/ContextProxy"
import { IndexingState, type CodeIndexSearchResponse } from "./interfaces/manager"
import { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager } from "./state-manager"
import { CodeIndexServiceFactory } from "./service-factory"
import { CodeIndexSearchService } from "./search-service"
import { CodeIndexOrchestrator } from "./orchestrator"
import { CacheManager } from "./cache-manager"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import fs from "fs/promises"
import ignore from "ignore"
import path from "path"
import { t } from "../../i18n"
import { IndexWriteGate } from "./index-write-gate"

import { GenerationAllocator } from "./generation-allocator"
import { FileFailureRegistry } from "./file-failure-registry"
import { codeIndexLog } from "./code-index-log"
import { ProviderPacerRegistry } from "./provider-pacer"
import { classifyIndexingError } from "./shared/indexing-errors"
import { formatProviderWaitMessage } from "./shared/provider-wait-message"
import type { FailedFileStatus, FailedFileSummary } from "@roo-code/types"

export class CodeIndexManager {
	// --- Singleton Implementation ---
	private static instances = new Map<string, CodeIndexManager>() // Map workspace path to instance

	// Specialized class instances
	private _configManager: CodeIndexConfigManager | undefined
	private readonly _stateManager: CodeIndexStateManager
	private _serviceFactory: CodeIndexServiceFactory | undefined
	private _orchestrator: CodeIndexOrchestrator | undefined
	private _searchService: CodeIndexSearchService | undefined
	private _cacheManager: CacheManager | undefined

	// Flag to prevent race conditions during error recovery
	private _isRecoveringFromError = false
	private parserFailed = false
	private parserFailureMessage = ""
	private servicesStopped = false
	private disabledSinceFailure = false
	private readonly writeGate = new IndexWriteGate()
	private generationAllocator?: GenerationAllocator
	private currentAttempt = 0
	private readonly idleStop = Promise.resolve()
	private clearing: Promise<void> = Promise.resolve()
	private startInFlight?: Promise<void>
	private servicesRestartPending = false
	private startupFailureMessage?: string
	private startupEpoch = 0
	public readonly fileFailureRegistry = new FileFailureRegistry()
	public readonly providerPacerRegistry = new ProviderPacerRegistry()
	private readonly progressEmitter = new vscode.EventEmitter<ReturnType<CodeIndexManager["getCurrentStatus"]>>()
	private readonly statusSubscriptions: vscode.Disposable[] = []

	public static getInstance(context: vscode.ExtensionContext, workspacePath?: string): CodeIndexManager | undefined {
		// Resolve the workspace folder to get both fsPath and the real URI
		let folder: vscode.WorkspaceFolder | undefined

		if (workspacePath) {
			folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === workspacePath)
		} else {
			const activeEditor = vscode.window.activeTextEditor
			if (activeEditor) {
				folder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
			}
			if (!folder) {
				const workspaceFolders = vscode.workspace.workspaceFolders
				if (!workspaceFolders || workspaceFolders.length === 0) {
					return undefined
				}
				folder = workspaceFolders[0]
			}
			workspacePath = folder.uri.fsPath
		}

		if (!CodeIndexManager.instances.has(workspacePath)) {
			// folder may be undefined when workspacePath was provided but doesn't match
			// any workspace folder (e.g. cwd passed from a tool). Fall back to file:// URI.
			const folderUri =
				folder?.uri ??
				({
					fsPath: workspacePath,
					scheme: "file",
					authority: "",
					path: workspacePath,
					toString: () => `file://${workspacePath}`,
				} as unknown as vscode.Uri)
			CodeIndexManager.instances.set(workspacePath, new CodeIndexManager(workspacePath, folderUri, context))
		}
		return CodeIndexManager.instances.get(workspacePath)!
	}

	public static getAllInstances(): CodeIndexManager[] {
		return Array.from(CodeIndexManager.instances.values())
	}

	public static disposeAll(): void {
		for (const instance of CodeIndexManager.instances.values()) {
			instance.dispose()
		}
		CodeIndexManager.instances.clear()
	}

	private readonly workspacePath: string
	private readonly _folderUri: vscode.Uri
	private readonly context: vscode.ExtensionContext

	// Private constructor for singleton pattern
	private constructor(workspacePath: string, folderUri: vscode.Uri, context: vscode.ExtensionContext) {
		this.workspacePath = workspacePath
		this._folderUri = folderUri
		this.context = context
		this._stateManager = new CodeIndexStateManager()
		this.configureDiagnostics()
		this.statusSubscriptions.push(
			this._stateManager.onProgressUpdate(() => this.progressEmitter.fire(this.getCurrentStatus())),
			this.fileFailureRegistry.onDidChange(() => this.progressEmitter.fire(this.getCurrentStatus())),
			this.providerPacerRegistry.onDidChange(() => this.progressEmitter.fire(this.getCurrentStatus())),
		)
	}

	// --- Public API ---

	/**
	 * Returns the workspaceState key for per-folder indexing enablement,
	 * keyed by the real workspace folder URI so local/remote schemes cannot collide.
	 */
	private _workspaceEnabledKey(): string {
		return "codeIndexWorkspaceEnabled:" + this._folderUri.toString(true)
	}

	public get isWorkspaceEnabled(): boolean {
		const explicit = this.context.workspaceState.get<boolean | undefined>(this._workspaceEnabledKey(), undefined)
		if (explicit !== undefined) return explicit
		return this.autoEnableDefault
	}

	public async setWorkspaceEnabled(enabled: boolean): Promise<void> {
		const wasEnabled = this.isWorkspaceEnabled
		await this.context.workspaceState.update(this._workspaceEnabledKey(), enabled)
		if (enabled && !wasEnabled) this.fileFailureRegistry.resetAllBudgets()
		if (!enabled) {
			this.disabledSinceFailure = true
			this.startupEpoch++
			if (!this._orchestrator) this.currentAttempt++
			void this.stopWatcher()
		} else if (this.disabledSinceFailure) {
			this.parserFailed = false
			this.startupFailureMessage = undefined
			this.disabledSinceFailure = false
		}
	}

	public get autoEnableDefault(): boolean {
		return this.context.globalState.get("codeIndexAutoEnableDefault", true)
	}

	public async setAutoEnableDefault(enabled: boolean): Promise<void> {
		await this.context.globalState.update("codeIndexAutoEnableDefault", enabled)
	}

	public get onProgressUpdate() {
		return this.progressEmitter.event
	}

	private assertInitialized() {
		if (!this._configManager || !this._orchestrator || !this._searchService || !this._cacheManager) {
			throw new Error("CodeIndexManager not initialized. Call initialize() first.")
		}
	}

	public get state(): IndexingState {
		return this.getCurrentStatus().systemStatus
	}

	public get isFeatureEnabled(): boolean {
		return this._configManager?.isFeatureEnabled ?? false
	}

	public get isFeatureConfigured(): boolean {
		return this._configManager?.isFeatureConfigured ?? false
	}

	public get isInitialized(): boolean {
		try {
			this.assertInitialized()
			return true
		} catch (error) {
			return false
		}
	}

	/**
	 * Initializes the manager with configuration and dependent services.
	 * Must be called before using any other methods.
	 * @returns Object indicating if a restart is needed
	 */
	public async initialize(contextProxy: ContextProxy, autoStart = true): Promise<{ requiresRestart: boolean }> {
		// 1. ConfigManager Initialization and Configuration Loading
		if (!this._configManager) {
			this._configManager = new CodeIndexConfigManager(contextProxy)
		}
		// Load configuration once to get current state and restart requirements
		const { requiresRestart } = await this._configManager.loadConfiguration()
		this.configureDiagnostics()

		// 2. Check if feature is enabled
		if (!this.isFeatureEnabled) {
			this.disabledSinceFailure = true
			void this.stopWatcher()
			return { requiresRestart }
		}

		// 3. Check if workspace is available
		const workspacePath = this.workspacePath
		if (!workspacePath) {
			this._stateManager.setSystemState("Standby", "No workspace folder open")
			return { requiresRestart }
		}

		// 4. Check workspace-level enablement (before creating expensive services)
		if (!this.isWorkspaceEnabled) {
			this._stateManager.setSystemState("Standby", "Indexing not enabled for this workspace")
			return { requiresRestart }
		}

		if (this.disabledSinceFailure) {
			this.parserFailed = false
			this.startupFailureMessage = undefined
			this.disabledSinceFailure = false
			this.fileFailureRegistry.resetAllBudgets()
		}
		if (autoStart && (this.parserFailed || this.startupFailureMessage)) {
			this._stateManager.setSystemState(
				"Error",
				this.parserFailed ? this.parserFailureMessage : this.startupFailureMessage,
			)
			return { requiresRestart }
		}

		// 5. CacheManager Initialization
		if (!this._cacheManager) {
			this._cacheManager = new CacheManager(this.context, this.workspacePath)
			await this._cacheManager.initialize()
			this.writeGate.recover(Object.keys(this._cacheManager.getOpenFiles()), this._cacheManager.loadedAt)
		}

		if (!autoStart) return { requiresRestart }

		// 6. Determine if Core Services Need Recreation
		const needsServiceRecreation = !this._serviceFactory || requiresRestart || this.servicesStopped

		if (needsServiceRecreation) {
			await this._recreateServices()
		}

		// 7. Handle Indexing Start/Restart
		const shouldStartOrRestartIndexing =
			requiresRestart ||
			(needsServiceRecreation && (!this._orchestrator || this._orchestrator.state !== "Indexing"))

		if (shouldStartOrRestartIndexing) {
			await this.scheduleScan()
		}

		return { requiresRestart }
	}

	/** Resolves after startup, without waiting for the background scan. */
	public startIndexing(contextProxy?: ContextProxy): Promise<void> {
		codeIndexLog.info("Start requested", { attempt: this.currentAttempt, overlapping: !!this.startInFlight })
		if (this.startInFlight) return this.startInFlight
		if (this._orchestrator?.isScanning) return this._orchestrator.startupResult
		return this.runStartup(async (epoch) => {
			if (contextProxy) await this.initialize(contextProxy, false)
			if (epoch !== this.startupEpoch || !this.isFeatureEnabled || !this.isWorkspaceEnabled) return
			this.parserFailed = false
			this.startupFailureMessage = undefined
			await this._recreateServices()
			if (epoch !== this.startupEpoch || !this.isWorkspaceEnabled) return
			this.fileFailureRegistry.resetAllBudgets()
			this.assertInitialized()
		})
	}

	private runStartup(operation: (epoch: number) => Promise<void>): Promise<void> {
		if (this.startInFlight) return this.startInFlight
		const epoch = this.startupEpoch
		const startup = Promise.resolve().then(async () => {
			try {
				await operation(epoch)
				while (
					epoch === this.startupEpoch &&
					!this.parserFailed &&
					this.isFeatureEnabled &&
					this.isWorkspaceEnabled
				) {
					if (this.servicesRestartPending) {
						this.servicesRestartPending = false
						await this._recreateServices()
						continue
					}
					await this.scheduleScan()
					if (!this.servicesRestartPending) break
				}
			} catch (error) {
				if (epoch !== this.startupEpoch) {
					codeIndexLog.info("Startup superseded", { attempt: this.currentAttempt })
					return
				}
				this.startupFailureMessage = codeIndexLog.redact(error instanceof Error ? error.message : String(error))
				this._stateManager.setSystemState("Error", this.startupFailureMessage)
				codeIndexLog.error("Indexing startup failed", { error, attempt: this.currentAttempt })
				throw error
			}
		})
		this.startInFlight = startup.finally(() => {
			this.startInFlight = undefined
			this.servicesRestartPending = false
		})
		return this.startInFlight
	}

	private async scheduleScan(): Promise<void> {
		const orchestrator = this._orchestrator
		if (!orchestrator) return
		const scan = orchestrator.startIndexing()
		void Promise.resolve(scan).catch((error) => {
			if (orchestrator !== this._orchestrator) return
			codeIndexLog.error("Background scan failed", { error, attempt: this.currentAttempt })
		})
		await orchestrator.startupResult
	}

	/**
	 * Stops any in-progress indexing operation and the file watcher.
	 */
	public stopIndexing(): Promise<void> {
		codeIndexLog.info("Stop requested", { attempt: this.currentAttempt, source: "stop-indexing" })
		this.startupEpoch++
		if (!this._orchestrator) {
			if (this.startInFlight) this.currentAttempt++
			return this.idleStop
		}
		const stopped = this._orchestrator.stopIndexing()
		this.servicesStopped = this._orchestrator.stopped
		return stopped
	}

	/**
	 * Stops the file watcher and potentially cleans up resources.
	 */
	public stopWatcher(): Promise<void> {
		codeIndexLog.info("Stop requested", { attempt: this.currentAttempt, source: "stop-watcher" })
		this.startupEpoch++
		if (this.startInFlight) this.currentAttempt++
		if (!this._orchestrator) return this.idleStop
		this.servicesStopped = true
		return this._orchestrator.stopWatcher()
	}

	/**
	 * Recovers from error state by clearing the error and resetting internal state.
	 * This allows the manager to be re-initialized after a recoverable error.
	 *
	 * This method clears all service instances (configManager, serviceFactory, orchestrator, searchService)
	 * to force a complete re-initialization on the next operation. This ensures a clean slate
	 * after recovering from errors such as network failures or configuration issues.
	 *
	 * @remarks
	 * - Safe to call even when not in error state (idempotent)
	 * - Does not restart indexing automatically - call initialize() after recovery
	 * - Service instances will be recreated on next initialize() call
	 * - Prevents race conditions from multiple concurrent recovery attempts
	 */
	public async recoverFromError(): Promise<void> {
		// Prevent race conditions from multiple rapid recovery attempts
		if (this._isRecoveringFromError) {
			return
		}

		this._isRecoveringFromError = true
		try {
			this.currentAttempt++
			void this._orchestrator?.stopWatcher()
			// Clear error state
			this._stateManager.setSystemState("Standby", "")
		} catch (error) {
			// Log error but continue with recovery - clearing service instances is more important
			codeIndexLog.error("Failed to clear error state during recovery", { error })
		} finally {
			// Force re-initialization by clearing service instances
			// This ensures a clean slate even if state update failed
			this._configManager = undefined
			this._serviceFactory = undefined
			this._orchestrator = undefined
			this._searchService = undefined

			// Reset the flag after recovery is complete
			this._isRecoveringFromError = false
		}
	}

	/**
	 * Cleans up the manager instance.
	 */
	public dispose(): void {
		this.currentAttempt++
		void this.stopWatcher()
		this.statusSubscriptions.forEach((subscription) => subscription?.dispose())
		this.progressEmitter.dispose()
		this._stateManager.dispose()
	}

	/**
	 * Clears all index data by stopping the watcher, clearing the Qdrant collection,
	 * and deleting the cache file.
	 */
	public async clearIndexData(): Promise<void> {
		if (!this.isFeatureEnabled) {
			return
		}
		this.assertInitialized()
		const clearing = this._orchestrator!.clearIndexData()
		this.clearing = clearing.catch(() => {})
		await clearing
	}

	// --- Private Helpers ---

	public getCurrentStatus() {
		const status = this._stateManager.getCurrentStatus()
		const failedFiles: FailedFileStatus[] = this.fileFailureRegistry.list().map((failure) => ({
			path: codeIndexLog.redact(
				path.isAbsolute(failure.path) ? path.relative(this.workspacePath, failure.path) : failure.path,
			),
			activity: failure.activity,
			reason: codeIndexLog.redact(failure.reason),
			state:
				this.servicesStopped || !this.isWorkspaceEnabled || !this.isFeatureEnabled
					? "exhausted"
					: failure.state,
		}))
		const representative = failedFiles.find((failure) => failure.state === "retrying") ?? failedFiles[0]
		const failedFileSummary: FailedFileSummary | undefined = representative
			? { ...representative, count: failedFiles.length }
			: undefined
		const stopped = this.servicesStopped || !this.isWorkspaceEnabled || !this.isFeatureEnabled
		const providerWaits = this.providerPacerRegistry.providerWaits().map((wait) => ({
			...wait,
			waitingFiles: wait.waitingFiles.map((file) =>
				codeIndexLog.redact(path.isAbsolute(file) ? path.relative(this.workspacePath, file) : file),
			),
		}))
		const waiting = !stopped && this.providerPacerRegistry.hasWaitingRequests()
		const incompleteFiles =
			failedFiles.length > 0 ||
			this.providerPacerRegistry.waitingPaths().length > 0 ||
			(stopped && Object.keys(this._cacheManager?.getOpenFiles?.() ?? {}).length > 0)
		const retrying = failedFiles.some((failure) => failure.state === "retrying")
		const canShowRecovery = status?.systemStatus !== "Error" && status?.systemStatus !== "Stopping"
		let recoveryMessage = status?.message
		if (canShowRecovery) {
			if (waiting) {
				recoveryMessage = formatProviderWaitMessage(providerWaits)
			} else if (incompleteFiles) {
				recoveryMessage = t(
					stopped
						? "embeddings:orchestrator.indexingStoppedPartial"
						: retrying
							? "embeddings:orchestrator.indexingFilesRetrying"
							: "embeddings:orchestrator.indexingFilesFailed",
				)
			}
		}
		return {
			...status,
			...(canShowRecovery && (incompleteFiles || waiting)
				? {
						systemStatus: (this.servicesStopped || !this.isWorkspaceEnabled || !this.isFeatureEnabled
							? "Standby"
							: waiting ||
								  this._orchestrator?.isActive ||
								  failedFiles.some((failure) => failure.state === "retrying")
								? "Indexing"
								: "Standby") as IndexingState,
					}
				: {}),
			...(this.parserFailed || this.startupFailureMessage
				? {
						systemStatus: "Error" as const,
						message: codeIndexLog.redact(
							this.parserFailed ? this.parserFailureMessage : this.startupFailureMessage!,
						),
					}
				: {}),
			...(!this.parserFailed && !this.startupFailureMessage && recoveryMessage !== undefined
				? { message: codeIndexLog.redact(recoveryMessage) }
				: {}),
			failedFiles,
			failedFileSummary,
			providerWaits,
			workspacePath: this.workspacePath,
			workspaceEnabled: this.isWorkspaceEnabled,
			autoEnableDefault: this.autoEnableDefault,
		}
	}

	public async searchIndex(
		query: string,
		directoryPrefix?: string,
		signal?: AbortSignal,
	): Promise<CodeIndexSearchResponse> {
		if (!this.isFeatureEnabled) {
			const failedFiles = this.fileFailureRegistry.list().map((failure) => failure.path)
			const waitingFiles = this.providerPacerRegistry.waitingPaths()
			return {
				results: [],
				partial: failedFiles.length > 0 || waitingFiles.length > 0,
				failedFiles,
				waitingFiles,
			}
		}
		this.assertInitialized()
		return this._searchService!.searchIndex(query, directoryPrefix, signal)
	}

	/**
	 * Private helper method to recreate services with current configuration.
	 * Used by both initialize() and handleSettingsChange().
	 */
	private async _recreateServices(): Promise<void> {
		const attempt = ++this.currentAttempt
		this._stateManager.setDiagnosticContext({ source: "manager", attempt })
		codeIndexLog.info("Rebuild requested", { attempt })
		const isCurrentAttempt = () => this.currentAttempt === attempt
		this.generationAllocator ??= new GenerationAllocator(this._cacheManager!)
		// Stop watcher if it exists
		if (this._orchestrator) {
			this.servicesStopped = true
			void this._orchestrator.stopWatcher()
		}
		// Clear existing services to ensure clean state
		this._orchestrator = undefined
		this._searchService = undefined

		// (Re)Initialize service factory
		this._serviceFactory = new CodeIndexServiceFactory(
			this._configManager!,
			this.workspacePath,
			this._cacheManager!,
			this.writeGate,
			this.generationAllocator,
			this.fileFailureRegistry,
			this.providerPacerRegistry,
		)

		const ignoreInstance = ignore()
		const workspacePath = this.workspacePath

		if (!workspacePath) {
			this._stateManager.setSystemState("Standby", "")
			return
		}

		// Create .gitignore instance
		const ignorePath = path.join(workspacePath, ".gitignore")
		try {
			const content = await fs.readFile(ignorePath, "utf8")
			ignoreInstance.add(content)
			ignoreInstance.add(".gitignore")
		} catch (error) {
			// Should never happen: reading file failed even though it exists
			codeIndexLog.debug("Could not load .gitignore", { error })
		}

		// Create RooIgnoreController instance
		const rooIgnoreController = new RooIgnoreController(workspacePath)
		await rooIgnoreController.initialize()
		// Clear publishes Standby before deleteCollection() settles; a retry must not write concurrently.
		await this.clearing

		if (!isCurrentAttempt()) {
			codeIndexLog.info("Rebuild superseded", { attempt })
			return
		}

		// (Re)Create shared service instances
		const { embedder, vectorStore, scanner, fileWatcher, parser } = this._serviceFactory.createServices(
			this.context,
			this._cacheManager!,
			ignoreInstance,
			rooIgnoreController,
		)

		const factory = this._serviceFactory
		const pacer = this.providerPacerRegistry.get(embedder.rateLimitScope)
		let deferredValidation = pacer.state().pausedUntil !== undefined
		let validationResult = { valid: true } as { valid: boolean; error?: string }
		if (!deferredValidation) {
			const issueSeq = pacer.markIssued()
			try {
				validationResult = await factory.validateEmbedder(embedder)
			} catch (error) {
				if (classifyIndexingError(error) !== "rate-limit") {
					parser?.stop()
					fileWatcher.dispose()
					throw error
				}
				pacer.reportRateLimit(error, issueSeq)
				deferredValidation = true
			}
		}
		if (!isCurrentAttempt()) {
			parser?.stop()
			fileWatcher.dispose()
			codeIndexLog.info("Rebuild superseded", { attempt })
			return
		}
		if (!validationResult.valid) {
			parser?.stop()
			fileWatcher.dispose()
			const errorMessage = validationResult.error || "Embedder configuration validation failed"
			this._stateManager.setSystemState("Error", errorMessage)
			throw new Error(errorMessage)
		}

		// (Re)Initialize orchestrator
		this._orchestrator = new CodeIndexOrchestrator(
			this._configManager!,
			this._stateManager,
			this.workspacePath,
			this._cacheManager!,
			vectorStore,
			scanner,
			fileWatcher,
			parser,
			(_error, message) => {
				if (!isCurrentAttempt()) return
				this.parserFailed = true
				this.parserFailureMessage = message
			},
			() => {
				if (isCurrentAttempt()) this.servicesStopped = true
			},
			this.writeGate,
			this.generationAllocator,
			isCurrentAttempt,
			this.fileFailureRegistry,
			this.providerPacerRegistry,
			deferredValidation
				? async (signal) => {
						const result = await pacer.run(undefined, signal, () => factory.validateEmbedder(embedder))
						if (!result.valid) throw new Error(result.error || "Embedder configuration validation failed")
					}
				: undefined,
		)
		this.servicesStopped = false

		// (Re)Initialize search service
		this._searchService = new CodeIndexSearchService(
			this._configManager!,
			this._stateManager,
			embedder,
			vectorStore,
			this.fileFailureRegistry,
			this.providerPacerRegistry,
		)

		// Clear any error state after successful recreation
		this._stateManager.setSystemState("Standby", "")
	}

	private configureDiagnostics(): void {
		const configurations = [...new Set([...CodeIndexManager.instances.values(), this])]
			.map((manager) => manager._configManager?.getConfig?.())
			.filter((config) => config !== undefined)
		codeIndexLog.configure({
			workspacePaths: [...CodeIndexManager.instances.keys(), this.workspacePath],
			secrets: configurations
				.flatMap((config) => [
					config.openAiOptions?.openAiNativeApiKey,
					config.openAiCompatibleOptions?.apiKey,
					config.geminiOptions?.apiKey,
					config.mistralOptions?.apiKey,
					config.vercelAiGatewayOptions?.apiKey,
					config.openRouterOptions?.apiKey,
					config.qdrantApiKey,
				])
				.filter((secret): secret is string => !!secret),
		})
	}

	/**
	 * Handle code index settings changes.
	 * This method should be called when code index settings are updated
	 * to ensure the CodeIndexConfigManager picks up the new configuration.
	 * If the configuration changes require a restart, the service will be restarted.
	 */
	public async handleSettingsChange(): Promise<void> {
		if (this._configManager) {
			const { requiresRestart } = await this._configManager.loadConfiguration()

			this.configureDiagnostics()

			const isFeatureEnabled = this.isFeatureEnabled
			const isFeatureConfigured = this.isFeatureConfigured

			// If feature is disabled, stop the service (including any active scan)
			if (!isFeatureEnabled) {
				this.disabledSinceFailure = true
				void this.stopWatcher()
				return
			}

			if (this.disabledSinceFailure) {
				this.parserFailed = false
				this.startupFailureMessage = undefined
				this.disabledSinceFailure = false
				this.fileFailureRegistry.resetAllBudgets()
			}
			if (this.parserFailed) return
			if (this.startInFlight) {
				// A service set already being built may have captured the previous settings.
				this.servicesRestartPending ||= requiresRestart
				return this.startInFlight
			}
			const startupFailed = this.startupFailureMessage !== undefined
			if ((requiresRestart || this.servicesStopped || startupFailed) && isFeatureEnabled && isFeatureConfigured) {
				return this.runStartup(async (epoch) => {
					this.startupFailureMessage = undefined
					// Ensure cacheManager is initialized before recreating services
					if (!this._cacheManager) {
						this._cacheManager = new CacheManager(this.context, this.workspacePath)
						await this._cacheManager.initialize()
						this.writeGate.recover(
							Object.keys(this._cacheManager.getOpenFiles()),
							this._cacheManager.loadedAt,
						)
					}

					if (epoch !== this.startupEpoch) return
					await this._recreateServices()
				})
			}
		}
	}
}
