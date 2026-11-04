import { APIConnectionError, APIUserAbortError } from "openai"

export type TransientClass = "rate-limit" | "server" | "connection"
export type IndexingErrorClassification = TransientClass | "permanent"

type ErrorDetails = {
	classification?: IndexingErrorClassification
	statusCode?: number
}

type ErrorShape = ErrorDetails & {
	name?: string
	code?: string
	status?: number
	response?: { status?: number }
	$metadata?: { httpStatusCode?: number }
	cause?: unknown
}

function errorChain(error: unknown): ErrorShape[] {
	const chain: ErrorShape[] = []
	const visited = new Set<unknown>()
	while (error && typeof error === "object" && !visited.has(error)) {
		visited.add(error)
		chain.push(error as ErrorShape)
		error = (error as ErrorShape).cause
	}
	return chain
}

function numericStatus(error: ErrorShape): number | undefined {
	return [error.status, error.statusCode, error.response?.status, error.$metadata?.httpStatusCode].find(
		(status) => typeof status === "number" && Number.isFinite(status),
	)
}

export function getIndexingErrorStatusCode(error: unknown): number | undefined {
	for (const entry of errorChain(error)) {
		const status = numericStatus(entry)
		if (status !== undefined) return status
	}
	return undefined
}

export function classifyIndexingError(error: unknown, signal?: AbortSignal): IndexingErrorClassification {
	const chain = errorChain(error)
	if (
		signal?.aborted ||
		error instanceof APIUserAbortError ||
		chain[0]?.name === "AbortError" ||
		chain[0]?.name === "APIUserAbortError"
	) {
		return "permanent"
	}
	for (const entry of chain) {
		if (
			entry.classification === "rate-limit" ||
			entry.classification === "server" ||
			entry.classification === "connection" ||
			entry.classification === "permanent"
		) {
			return entry.classification
		}
	}
	if (chain.some((entry) => entry instanceof APIUserAbortError || entry.name === "AbortError")) return "permanent"
	const status = getIndexingErrorStatusCode(error)
	if (status !== undefined) {
		if (status === 429) return "rate-limit"
		return status >= 500 && status < 600 ? "server" : "permanent"
	}
	const networkCodes = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE"])
	for (const entry of chain) {
		if (
			(typeof entry.code === "string" &&
				(networkCodes.has(entry.code) ||
					entry.code.startsWith("UND_ERR_") ||
					entry.code.startsWith("ERR_HTTP2_"))) ||
			(entry instanceof TypeError && entry.cause !== undefined) ||
			entry instanceof APIConnectionError ||
			entry.name === "APIConnectionError" ||
			entry.name === "APIConnectionTimeoutError" ||
			entry.name === "TimeoutError" ||
			entry.name === "QdrantClientTimeoutError"
		) {
			return "connection"
		}
	}
	return "permanent"
}

class IndexingError extends Error {
	readonly classification: IndexingErrorClassification
	readonly statusCode?: number

	constructor(message: string, cause: unknown, details?: ErrorDetails) {
		super(message, { cause })
		this.name = new.target.name
		this.classification = details?.classification ?? classifyIndexingError(cause)
		this.statusCode = details?.statusCode ?? getIndexingErrorStatusCode(cause)
	}
}

export class EmbeddingError extends IndexingError {}
export class VectorStoreError extends IndexingError {}
