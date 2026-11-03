import { Task } from "../task/Task"
import { ClineProvider, type PendingEditOperation } from "./ClineProvider"
import { saveTaskMessages } from "../task-persistence"
import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import { t } from "../../i18n"

export interface CheckpointRestoreConfig {
	provider: ClineProvider
	currentCline: Task
	messageTs: number
	messageIndex: number
	checkpoint: { hash: string }
	operation: "delete" | "edit"
	editData?: {
		editedContent: string
		images?: string[]
		apiConversationHistoryIndex: number
	}
}

/**
 * Handles checkpoint restoration for both delete and edit operations.
 * This consolidates the common logic while handling operation-specific behavior.
 */
export async function handleCheckpointRestoreOperation(config: CheckpointRestoreConfig): Promise<void> {
	const { provider, currentCline, messageTs, checkpoint, operation, editData } = config

	let checkpointRestored = false
	let restoreAttempted = false
	let cancelledByHandler = false
	let pendingEditOwner: PendingEditOperation | undefined

	try {
		// For delete operations, ensure the task is properly aborted to handle any pending ask operations
		// This prevents "Current ask promise was ignored" errors
		// For edit operations, we don't abort because the checkpoint restore will handle it
		if (operation === "delete" && currentCline && !currentCline.abort) {
			cancelledByHandler = true
			await currentCline.abortTask()
			// Wait a bit for the abort to complete
			await pWaitFor(() => currentCline.abort === true, {
				timeout: 1000,
				interval: 50,
			}).catch(() => {
				// Continue even if timeout - the abort flag should be set
			})
		}

		// For edit operations, set up pending edit data before restoration
		if (operation === "edit" && editData) {
			const operationId = `task-${currentCline.taskId}`
			pendingEditOwner = provider.setPendingEditOperation(operationId, {
				messageTs,
				editedContent: editData.editedContent,
				images: editData.images,
				messageIndex: config.messageIndex,
				apiConversationHistoryIndex: editData.apiConversationHistoryIndex,
			})
		}

		// Perform the checkpoint restoration
		restoreAttempted = true
		await currentCline.checkpointRestore({
			ts: messageTs,
			commitHash: checkpoint.hash,
			mode: "restore",
			operation,
			...(pendingEditOwner ? { pendingEditOwner } : {}),
			...(operation === "delete" ? { rehydrate: false } : {}),
		})
		checkpointRestored = true

		// Deletion owns its resume so installation cannot race this final save.
		if (operation === "delete") {
			// Save the updated messages to disk after checkpoint restoration
			await saveTaskMessages({
				messages: currentCline.clineMessages,
				taskId: currentCline.taskId,
				globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
			})

			// Get the updated history item and reinitialize
			const { historyItem } = await provider.getTaskWithId(currentCline.taskId)
			await provider.createTaskWithHistoryItem(historyItem, { expectedSession: currentCline })
		}
		// For edit operations, the task cancellation in checkpointRestore
		// will trigger reinitialization, which will process pendingEditAfterRestore
	} catch (error) {
		if (!checkpointRestored && pendingEditOwner) {
			provider.clearPendingEditOperation(`task-${currentCline.taskId}`, pendingEditOwner)
		}
		console.error(`Error in checkpoint restore (${operation}):`, error)
		void vscode.window.showErrorMessage(
			t("common:errors.checkpoint_restore_failed", {
				error: error instanceof Error ? error.message : String(error),
			}),
		)
		if (
			operation === "delete" &&
			cancelledByHandler &&
			restoreAttempted &&
			!checkpointRestored &&
			currentCline.abort &&
			provider.getCurrentTask() === currentCline
		) {
			try {
				const restart = t("common:checkpoints.restart")
				const response = await vscode.window.showWarningMessage(
					t("common:checkpoints.restart_after_restore_failure"),
					restart,
				)
				if (response === restart && provider.getCurrentTask() === currentCline) {
					await provider.restartTaskIfCurrent(currentCline)
				}
			} catch (restartError) {
				console.error("Failed to restart task after checkpoint restore failure:", restartError)
			}
		}
		throw error
	}
}

/**
 * Common checkpoint restore validation and initialization utility.
 * This can be used by any checkpoint restore flow that needs to wait for initialization.
 */
export async function waitForClineInitialization(provider: ClineProvider, timeoutMs: number = 3000): Promise<boolean> {
	try {
		await pWaitFor(() => provider.getCurrentTask()?.isInitialized === true, {
			timeout: timeoutMs,
		})
		return true
	} catch (error) {
		vscode.window.showErrorMessage(t("common:errors.checkpoint_timeout"))
		return false
	}
}
