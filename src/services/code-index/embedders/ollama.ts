import { codeIndexLog } from "../code-index-log"
import { ApiHandlerOptions } from "../../../shared/api"
import { EmbedderInfo, EmbeddingResponse, IEmbedder } from "../interfaces"
import { getModelQueryPrefix } from "../../../shared/embeddingModels"
import { MAX_ITEM_TOKENS } from "../constants"
import { t } from "../../../i18n"
import { withValidationErrorHandling } from "../shared/validation-helpers"
import { EmbeddingError, type TransientClass } from "../shared/indexing-errors"

const OLLAMA_EMBEDDING_TIMEOUT_MS = 60000 // 60 seconds for embedding requests
const OLLAMA_VALIDATION_TIMEOUT_MS = 30000 // 30 seconds for validation requests

export class CodeIndexOllamaEmbedder implements IEmbedder {
	readonly internallyRetriedClasses: ReadonlySet<TransientClass> = new Set()
	private readonly baseUrl: string
	private readonly defaultModelId: string

	constructor(options: ApiHandlerOptions) {
		let baseUrl = options.ollamaBaseUrl || "http://localhost:11434"

		baseUrl = baseUrl.replace(/\/+$/, "")

		this.baseUrl = baseUrl
		this.defaultModelId = options.ollamaModelId || "nomic-embed-text:latest"
	}

	/**
	 * Embeds texts with Ollama; model overrides the default.
	 * Returns embeddings and usage data.
	 */
	async createEmbeddings(texts: string[], model?: string, signal?: AbortSignal): Promise<EmbeddingResponse> {
		signal?.throwIfAborted()
		const modelToUse = model || this.defaultModelId
		const url = `${this.baseUrl}/api/embed`

		// Apply model-specific query prefix if required
		const queryPrefix = getModelQueryPrefix("ollama", modelToUse)
		const processedTexts = queryPrefix
			? texts.map((text, index) => {
					// Prevent double-prefixing
					if (text.startsWith(queryPrefix)) {
						return text
					}
					const prefixedText = `${queryPrefix}${text}`
					const estimatedTokens = Math.ceil(prefixedText.length / 4)
					if (estimatedTokens > MAX_ITEM_TOKENS) {
						codeIndexLog.warn(
							t("embeddings:textWithPrefixExceedsTokenLimit", {
								index,
								estimatedTokens,
								maxTokens: MAX_ITEM_TOKENS,
							}),
						)
						// Return original text if adding prefix would exceed limit
						return text
					}
					return prefixedText
				})
			: texts

		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), OLLAMA_EMBEDDING_TIMEOUT_MS)
		const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: modelToUse,
					input: processedTexts,
				}),
				signal: requestSignal,
			})
			signal?.throwIfAborted()

			if (!response.ok) {
				let errorBody = t("embeddings:ollama.couldNotReadErrorBody")
				try {
					errorBody = await response.text()
				} catch (e) {
					// Ignore error reading body
				}
				throw new EmbeddingError(
					t("embeddings:ollama.requestFailed", {
						status: response.status,
						statusText: response.statusText,
						errorBody,
					}),
					response,
				)
			}

			const data = await response.json()
			signal?.throwIfAborted()

			const embeddings = data.embeddings
			if (!embeddings || !Array.isArray(embeddings)) {
				throw new Error(t("embeddings:ollama.invalidResponseStructure"))
			}

			return {
				embeddings: embeddings,
			}
		} catch (error: any) {
			signal?.throwIfAborted()
			codeIndexLog.error("Ollama embedding failed:", error)

			if (error.name === "AbortError") {
				throw new EmbeddingError(t("embeddings:validation.connectionFailed"), error, {
					classification: controller.signal.aborted ? "connection" : "permanent",
				})
			} else if (error.message?.includes("fetch failed") || error.code === "ECONNREFUSED") {
				throw new EmbeddingError(t("embeddings:ollama.serviceNotRunning", { baseUrl: this.baseUrl }), error)
			} else if (error.code === "ENOTFOUND") {
				throw new EmbeddingError(t("embeddings:ollama.hostNotFound", { baseUrl: this.baseUrl }), error)
			}

			throw new EmbeddingError(t("embeddings:ollama.embeddingFailed", { message: error.message }), error, {
				retryAfterMs: error instanceof EmbeddingError ? error.retryAfterMs : undefined,
			})
		} finally {
			clearTimeout(timeoutId)
		}
	}

	/** Checks service availability and model existence; returns validity and an optional error. */
	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		return withValidationErrorHandling(
			async () => {
				// First check if Ollama service is running by trying to list models
				const modelsUrl = `${this.baseUrl}/api/tags`

				// Add timeout to prevent indefinite hanging
				const controller = new AbortController()
				const timeoutId = setTimeout(() => controller.abort(), OLLAMA_VALIDATION_TIMEOUT_MS)

				const modelsResponse = await fetch(modelsUrl, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
					},
					signal: controller.signal,
				})
				clearTimeout(timeoutId)

				if (!modelsResponse.ok) {
					if (modelsResponse.status === 404) {
						return {
							valid: false,
							error: t("embeddings:ollama.serviceNotRunning", { baseUrl: this.baseUrl }),
						}
					}
					return {
						valid: false,
						error: t("embeddings:ollama.serviceUnavailable", {
							baseUrl: this.baseUrl,
							status: modelsResponse.status,
						}),
					}
				}

				// Check if the specific model exists
				const modelsData = await modelsResponse.json()
				const models = modelsData.models || []

				// Check both with and without :latest suffix
				const modelExists = models.some((m: any) => {
					const modelName = m.name || ""
					return (
						modelName === this.defaultModelId ||
						modelName === `${this.defaultModelId}:latest` ||
						modelName === this.defaultModelId.replace(":latest", "")
					)
				})

				if (!modelExists) {
					const availableModels = models.map((m: any) => m.name).join(", ")
					return {
						valid: false,
						error: t("embeddings:ollama.modelNotFound", {
							modelId: this.defaultModelId,
							availableModels,
						}),
					}
				}

				// Try a test embedding to ensure the model works for embeddings
				const testUrl = `${this.baseUrl}/api/embed`

				// Add timeout for test request too
				const testController = new AbortController()
				const testTimeoutId = setTimeout(() => testController.abort(), OLLAMA_VALIDATION_TIMEOUT_MS)

				const testResponse = await fetch(testUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: this.defaultModelId,
						input: ["test"],
					}),
					signal: testController.signal,
				})
				clearTimeout(testTimeoutId)

				if (!testResponse.ok) {
					return {
						valid: false,
						error: t("embeddings:ollama.modelNotEmbeddingCapable", { modelId: this.defaultModelId }),
					}
				}

				return { valid: true }
			},
			"ollama",
			{
				beforeStandardHandling: (error: any) => {
					// Handle Ollama-specific connection errors.
					if (
						error?.message?.includes("fetch failed") ||
						error?.code === "ECONNREFUSED" ||
						error?.message?.includes("ECONNREFUSED")
					) {
						return {
							valid: false,
							error: t("embeddings:ollama.serviceNotRunning", { baseUrl: this.baseUrl }),
						}
					} else if (error?.code === "ENOTFOUND" || error?.message?.includes("ENOTFOUND")) {
						return {
							valid: false,
							error: t("embeddings:ollama.hostNotFound", { baseUrl: this.baseUrl }),
						}
					} else if (error?.name === "AbortError") {
						return {
							valid: false,
							error: t("embeddings:validation.connectionFailed"),
						}
					}
					return undefined
				},
			},
		)
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "ollama",
		}
	}
}
