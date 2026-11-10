import { FILE_RETRY_ATTEMPTS, FILE_RETRY_BASE_DELAY_MS, RATE_LIMIT_MAX_RETRY_AFTER_MS } from "../constants"
import { waitForRetry } from "../embedders/cancellation"
import { classifyIndexingError, type IndexingErrorClassification, type TransientClass } from "./indexing-errors"

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
	ownedClasses?: ReadonlySet<TransientClass>
	budget?: RetryBudget
	onFailure?: (failure: RetryFailure) => void
}

export async function retryWithPolicy<T>(
	operation: () => Promise<T>,
	{ signal, ownedClasses, budget = { retriesUsed: 0 }, onFailure }: RetryPolicyOptions = {},
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
				throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
					attempts: attempt,
					classification,
				})
			}
			await waitForRetry(delayMs, signal)
		}
	}
}
