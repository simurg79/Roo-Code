import type { Task } from "../task/Task"
import { t } from "../../i18n"

const FULL_COMMIT_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export function assertRecordedCheckpoint(
	task: Pick<Task, "taskId" | "clineMessages">,
	commitHash: unknown,
): asserts commitHash is string {
	const isRecorded =
		typeof commitHash === "string" &&
		FULL_COMMIT_HASH.test(commitHash) &&
		task.clineMessages.some(({ say, text }) => say === "checkpoint_saved" && text === commitHash)

	if (!isRecorded) {
		throw new Error(t("common:errors.checkpoint_invalid"))
	}
}
