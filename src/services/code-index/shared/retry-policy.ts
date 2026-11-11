import { APIUserAbortError } from "openai"
import { FILE_RETRY_ATTEMPTS, FILE_RETRY_BASE_DELAY_MS, RATE_LIMIT_MAX_RETRY_AFTER_MS } from "../constants"
import { waitForRetry } from "../embedders/cancellation"
import {
	classifyIndexingError,
	IndexingRetryError,
	type IndexingErrorClassification,
	type TransientClass,
} from "./indexing-errors"
import type { FileFailureActivity } from "../file-failure-registry"

export interface RetryBudget {
	retriesUsed: number
}

export interface RetryFailure {
	error: unknown
	attempt: number
	classification: IndexingErrorClassification
	willRetry: boolean
	delayMs: number
	delaySource: "default" | "provider"
	retryAfterRefusedMs?: number
}

export interface RetryPolicyOptions {
	signal?: AbortSignal
	activity?: FileFailureActivity
	ownedClasses?: ReadonlySet<TransientClass>
	budget?: RetryBudget
	onFailure?: (failure: RetryFailure) => void
}

export async function retryWithPolicy<T>(
	operation: () => Promise<T>,
	{ signal, activity, ownedClasses, budget = { retriesUsed: 0 }, onFailure }: RetryPolicyOptions = {},
): Promise<T> {
	while (true) {
		signal?.throwIfAborted()
		try {
			return await operation()
		} catch (error) {
			signal?.throwIfAborted()
			const classification = classifyIndexingError(error, signal)
			const attempt = budget.retriesUsed + 1
			const willRetry =
				classification !== "permanent" && !ownedClasses?.has(classification) && attempt < FILE_RETRY_ATTEMPTS
			const defaultDelayMs = FILE_RETRY_BASE_DELAY_MS * 2 ** budget.retriesUsed
			const requestedDelay = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs
			const providerDelay =
				classification === "rate-limit" &&
				typeof requestedDelay === "number" &&
				Number.isFinite(requestedDelay) &&
				requestedDelay >= 0
					? requestedDelay
					: undefined
			const retryAfterRefusedMs =
				providerDelay !== undefined && providerDelay > RATE_LIMIT_MAX_RETRY_AFTER_MS ? providerDelay : undefined
			const acceptedDelay = retryAfterRefusedMs === undefined ? (providerDelay ?? 0) : 0
			const delayMs = willRetry ? Math.max(defaultDelayMs, acceptedDelay) : 0
			if (willRetry) budget.retriesUsed++
			onFailure?.({
				error,
				attempt,
				classification,
				willRetry,
				delayMs,
				delaySource: acceptedDelay > defaultDelayMs ? "provider" : "default",
				retryAfterRefusedMs,
			})
			if (!willRetry) {
				if (
					error instanceof APIUserAbortError ||
					(error &&
						typeof error === "object" &&
						"name" in error &&
						(error.name === "AbortError" || error.name === "APIUserAbortError"))
				)
					throw error
				throw new IndexingRetryError(error, attempt, classification, activity)
			}
			await waitForRetry(delayMs, signal)
		}
	}
}
