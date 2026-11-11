import { VectorStoreSearchResult } from "./vector-store"
import type { FailedFileStatus, FailedFileSummary, ProviderWaitStatus } from "@roo-code/types"
import * as vscode from "vscode"

export interface CodeIndexSearchResponse {
	results: VectorStoreSearchResult[]
	partial: boolean
	failedFiles: string[]
	waitingFiles: string[]
}

/**
 * Interface for the code index manager
 */
export interface ICodeIndexManager {
	/**
	 * Event emitted when progress is updated
	 */
	onProgressUpdate: vscode.Event<{
		systemStatus: IndexingState
		fileStatuses: Record<string, string>
		message?: string
		failedFiles?: FailedFileStatus[]
		failedFileSummary?: FailedFileSummary
		providerWaits?: ProviderWaitStatus[]
	}>

	/**
	 * Current state of the indexing process
	 */
	readonly state: IndexingState

	/**
	 * Whether the code indexing feature is enabled
	 */
	readonly isFeatureEnabled: boolean

	/**
	 * Whether the code indexing feature is configured
	 */
	readonly isFeatureConfigured: boolean

	/**
	 * Loads configuration from storage
	 */
	loadConfiguration(): Promise<void>

	/**
	 * Starts the indexing process
	 */
	startIndexing(): Promise<void>

	/**
	 * Stops any in-progress indexing operation and the file watcher
	 */
	stopIndexing(): void

	/**
	 * Stops the file watcher
	 */
	stopWatcher(): void

	/**
	 * Clears the index data
	 */
	clearIndexData(): Promise<void>

	/**
	 * Searches the index
	 * @param query Query string
	 * @param directoryPrefix Optional directory path to filter results by
	 * @returns Search results and partial-index details
	 */
	searchIndex(query: string, directoryPrefix?: string, signal?: AbortSignal): Promise<CodeIndexSearchResponse>

	/**
	 * Gets the current status of the indexing system
	 * @returns Current status information
	 */
	getCurrentStatus(): {
		systemStatus: IndexingState
		fileStatuses: Record<string, string>
		message?: string
		failedFiles?: FailedFileStatus[]
		failedFileSummary?: FailedFileSummary
		providerWaits?: ProviderWaitStatus[]
	}

	/**
	 * Disposes of resources used by the manager
	 */
	dispose(): void
}

export type IndexingState = "Standby" | "Indexing" | "Indexed" | "Error" | "Stopping"
export type EmbedderProvider =
	| "openai"
	| "ollama"
	| "openai-compatible"
	| "gemini"
	| "mistral"
	| "vercel-ai-gateway"
	| "bedrock"
	| "openrouter"

export interface IndexProgressUpdate {
	systemStatus: IndexingState
	message?: string
	processedBlockCount?: number
	totalBlockCount?: number
	failedFiles?: FailedFileStatus[]
	failedFileSummary?: FailedFileSummary
	providerWaits?: ProviderWaitStatus[]
}
