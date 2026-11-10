import { t } from "../../../i18n"
import { serializeError } from "serialize-error"
import { classifyIndexingError, EmbeddingError, getIndexingErrorStatusCode } from "./indexing-errors"

/** Removes sensitive information, including paths and URLs, from error messages. */
export function sanitizeErrorMessage(errorMessage: string): string {
	if (!errorMessage || typeof errorMessage !== "string") {
		return String(errorMessage)
	}

	let sanitized = errorMessage

	// Redact http/https/ftp/file URLs before paths to avoid partial replacements.
	sanitized = sanitized.replace(
		/(?:https?|ftp|file):\/\/(?:localhost|[\w\-\.]+)(?::\d+)?(?:\/[\w\-\.\/\?\&\=\#]*)?/gi,
		"[REDACTED_URL]",
	)

	sanitized = sanitized.replace(/[\w\-\.]+@[\w\-\.]+\.\w+/g, "[REDACTED_EMAIL]")

	sanitized = sanitized.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]")

	// Replace file paths in quotes (handles paths with spaces)
	sanitized = sanitized.replace(/"[^"]*(?:\/|\\)[^"]*"/g, '"[REDACTED_PATH]"')

	// Replace file paths (Unix and Windows style)
	// Matches paths like /Users/username/path, C:\Users\path, ./relative/path, ../relative/path
	sanitized = sanitized.replace(
		/(?:\/[\w\-\.]+)+(?:\/[\w\-\.\s]*)*|(?:[A-Za-z]:\\[\w\-\.\\]+)|(?:\.{1,2}\/[\w\-\.\/]+)/g,
		"[REDACTED_PATH]",
	)

	// Redact ports after URLs to avoid double replacement.
	sanitized = sanitized.replace(/(?<!REDACTED_URL\]):(\d{2,5})\b/g, ":[REDACTED_PORT]")

	return sanitized
}

/** Embedder HTTP errors. */
export interface HttpError extends Error {
	status?: number
	headers?: Headers
	response?: {
		status?: number
	}
}

/** Common embedder validation errors. */
export interface ValidationError {
	status?: number
	message?: string
	name?: string
	code?: string
}

export function getErrorMessageForStatus(status: number | undefined, embedderType: string): string | undefined {
	switch (status) {
		case 401:
		case 403:
			return t("embeddings:validation.authenticationFailed")
		case 404:
			return embedderType === "openai"
				? t("embeddings:validation.modelNotAvailable")
				: t("embeddings:validation.invalidEndpoint")
		case 429:
			return t("embeddings:validation.serviceUnavailable")
		default:
			if (status && status >= 400 && status < 600) {
				return t("embeddings:validation.configurationError")
			}
			return undefined
	}
}

export function extractStatusCode(error: any): number | undefined {
	if (error?.status) return error.status

	if (error?.response?.status) return error.response.status

	// Extract from error message (e.g., "HTTP 404: Not Found")
	if (error?.message) {
		const match = error.message.match(/HTTP (\d+):/)
		if (match) {
			return parseInt(match[1], 10)
		}
	}

	// Use serialize-error as fallback for complex objects
	const serialized = serializeError(error)
	if (serialized?.status) return serialized.status
	if (serialized?.response?.status) return serialized.response.status

	return undefined
}

export function extractErrorMessage(error: any): string {
	if (error?.message) {
		return error.message
	}

	if (typeof error === "string") {
		return error
	}

	if (error && typeof error === "object" && "toString" in error) {
		try {
			return String(error)
		} catch {
			return "Unknown error"
		}
	}

	// Use serialize-error as fallback for complex objects
	const serialized = serializeError(error)
	if (serialized?.message) {
		return serialized.message
	}

	return "Unknown error"
}

/** Returns a consistent embedder configuration validation response by error type. */
export function handleValidationError(
	error: any,
	embedderType: string,
	customHandlers?: {
		beforeStandardHandling?: (error: any) => { valid: boolean; error: string } | undefined
	},
): { valid: boolean; error: string } {
	// Serialization exposes all error properties.
	const serializedError = serializeError(error)

	// Pass the original error to custom handlers for backward compatibility.
	if (customHandlers?.beforeStandardHandling) {
		const customResult = customHandlers.beforeStandardHandling(error)
		if (customResult) return customResult
	}

	const statusCode = extractStatusCode(serializedError)
	const errorMessage = extractErrorMessage(serializedError)

	const statusError = getErrorMessageForStatus(statusCode, embedderType)
	if (statusError) {
		return { valid: false, error: statusError }
	}

	if (errorMessage) {
		if (
			errorMessage.includes("ENOTFOUND") ||
			errorMessage.includes("ECONNREFUSED") ||
			errorMessage.includes("ETIMEDOUT") ||
			errorMessage === "AbortError" ||
			errorMessage.includes("HTTP 0:") ||
			errorMessage === "No response"
		) {
			return { valid: false, error: t("embeddings:validation.connectionFailed") }
		}

		if (errorMessage.includes("Failed to parse response JSON")) {
			return { valid: false, error: t("embeddings:validation.invalidResponse") }
		}
	}

	if (errorMessage && errorMessage !== "Unknown error") {
		return { valid: false, error: errorMessage }
	}

	return { valid: false, error: t("embeddings:validation.configurationError") }
}

export async function withValidationErrorHandling<T extends { valid: boolean; error?: string }>(
	validationFn: () => Promise<T>,
	embedderType: string,
	customHandlers?: Parameters<typeof handleValidationError>[2],
): Promise<{ valid: boolean; error?: string }> {
	try {
		return await validationFn()
	} catch (error) {
		return handleValidationError(error, embedderType, customHandlers)
	}
}

export function formatEmbeddingError(error: unknown): EmbeddingError {
	const classification = classifyIndexingError(error)
	const statusCode = getIndexingErrorStatusCode(error)
	const errorMessage = extractErrorMessage(error)
	const details = { classification, statusCode }

	if (statusCode === 401) {
		return new EmbeddingError(t("embeddings:authenticationFailed"), error, details)
	} else if (statusCode) {
		return new EmbeddingError(t("embeddings:failedWithStatus", { statusCode, errorMessage }), error, details)
	} else {
		return new EmbeddingError(t("embeddings:failedWithError", { errorMessage }), error, details)
	}
}
