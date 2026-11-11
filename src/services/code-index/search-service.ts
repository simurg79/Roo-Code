import { codeIndexLog } from "./code-index-log"
import * as path from "path"
import type { CodeIndexSearchResponse } from "./interfaces/manager"
import { FileFailureRegistry } from "./file-failure-registry"
import { IEmbedder } from "./interfaces/embedder"
import { IVectorStore } from "./interfaces/vector-store"
import { CodeIndexConfigManager } from "./config-manager"
import { CodeIndexStateManager } from "./state-manager"
import { retryWithPolicy } from "./shared/retry-policy"

/**
 * Service responsible for searching the code index.
 */
export class CodeIndexSearchService {
	constructor(
		private readonly configManager: CodeIndexConfigManager,
		private readonly stateManager: CodeIndexStateManager,
		private readonly embedder: IEmbedder,
		private readonly vectorStore: IVectorStore,
		private readonly failures: FileFailureRegistry,
	) {}

	/**
	 * Searches the code index for relevant content.
	 * @param query The search query
	 * @param directoryPrefix Optional directory path to filter results by
	 * @returns Search results and partial-index details
	 * @throws Error if the service is not properly configured or ready
	 */
	public async searchIndex(
		query: string,
		directoryPrefix?: string,
		signal?: AbortSignal,
	): Promise<CodeIndexSearchResponse> {
		if (!this.configManager.isFeatureEnabled || !this.configManager.isFeatureConfigured) {
			throw new Error("Code index feature is disabled or not configured.")
		}

		const minScore = this.configManager.currentSearchMinScore
		const maxResults = this.configManager.currentSearchMaxResults

		const currentState = this.stateManager.getCurrentStatus().systemStatus
		const partialStandby =
			currentState === "Standby" && this.failures.list().length > 0 && (await this.vectorStore.collectionExists())
		if (currentState !== "Indexed" && currentState !== "Indexing" && !partialStandby) {
			throw new Error(`Code index is not ready for search. Current state: ${currentState}`)
		}

		try {
			const embeddingResponse = await retryWithPolicy(
				() => this.embedder.createEmbeddings([query], undefined, signal),
				{ signal, ownedClasses: this.embedder.internallyRetriedClasses },
			)
			signal?.throwIfAborted()
			const vector = embeddingResponse?.embeddings[0]
			if (!vector) {
				throw new Error("Failed to generate embedding for query.")
			}

			// Handle directory prefix
			let normalizedPrefix: string | undefined = undefined
			if (directoryPrefix) {
				normalizedPrefix = path.normalize(directoryPrefix)
			}

			// Perform search
			const results = await this.vectorStore.search(vector, normalizedPrefix, minScore, maxResults)
			const failedFiles = this.failures.list().map((failure) => failure.path)
			return { results, partial: failedFiles.length > 0, failedFiles }
		} catch (error) {
			codeIndexLog.error("Search failed", { error })
			throw error
		}
	}
}
