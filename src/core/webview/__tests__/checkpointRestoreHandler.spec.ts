import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import type { Task } from "../../task/Task"
import type { ClineProvider, PendingEditOperation } from "../ClineProvider"
import { handleCheckpointRestoreOperation, type CheckpointRestoreConfig } from "../checkpointRestoreHandler"
import { saveTaskMessages } from "../../task-persistence"

vi.mock("../../task-persistence", () => ({ saveTaskMessages: vi.fn() }))
vi.mock("p-wait-for", () => ({ default: vi.fn(async () => {}) }))
vi.mock("../../../i18n", () => ({
	t: (key: string, options?: { error?: string }) => (options ? `${key}: ${options.error}` : key),
}))
vi.mock("vscode", () => ({ window: { showErrorMessage: vi.fn(), showWarningMessage: vi.fn() } }))

function createFixture() {
	const taskDouble = {
		taskId: "task",
		abort: false,
		clineMessages: [{ ts: 1, type: "say", say: "text", text: "Saved conversation" }],
		checkpointRestore: vi.fn(async (_options: unknown) => {}),
		abortTask: vi.fn(async () => {
			taskDouble.abort = true
		}),
	}
	const task = taskDouble as unknown as Task
	const pending = new Map<string, PendingEditOperation>()
	const providerDouble = {
		getCurrentTask: vi.fn(() => task as Task | undefined),
		setPendingEditOperation: vi.fn((id: string, data: object) => {
			const owner = { ...data, ready: false } as PendingEditOperation
			pending.set(id, owner)
			return owner
		}),
		clearPendingEditOperation: vi.fn((id: string, owner: PendingEditOperation) => {
			if (pending.get(id) !== owner) return false
			return pending.delete(id)
		}),
		restartTaskIfCurrent: vi.fn(async (_session: Task) => true),
		getTaskWithId: vi.fn(async (_id: string) => ({ historyItem: { id: "task" } })),
		createTaskWithHistoryItem: vi.fn(async (_item: unknown, _options: unknown) => task),
		contextProxy: { globalStorageUri: { fsPath: "/storage" } },
	}
	const config: CheckpointRestoreConfig = {
		provider: providerDouble as unknown as ClineProvider,
		currentCline: task,
		messageTs: 1,
		messageIndex: 0,
		checkpoint: { hash: "a".repeat(40) },
		operation: "delete",
	}
	return { task, taskDouble, providerDouble, pending, config }
}

describe("checkpoint restore handler", () => {
	let fixture: ReturnType<typeof createFixture>
	beforeEach(() => {
		vi.clearAllMocks()
		fixture = createFixture()
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined)
		vi.spyOn(console, "error").mockImplementation(() => {})
	})
	afterEach(() => vi.restoreAllMocks())

	it("stops deletes before restoring, saves messages and guards rehydration by session", async () => {
		await handleCheckpointRestoreOperation(fixture.config)
		expect(fixture.taskDouble.checkpointRestore).toHaveBeenCalledWith(expect.objectContaining({ rehydrate: false }))
		expect(fixture.taskDouble.abortTask.mock.invocationCallOrder[0]).toBeLessThan(
			fixture.taskDouble.checkpointRestore.mock.invocationCallOrder[0],
		)
		expect(saveTaskMessages).toHaveBeenCalledWith({
			messages: fixture.task.clineMessages,
			taskId: "task",
			globalStoragePath: "/storage",
		})
		expect(fixture.providerDouble.createTaskWithHistoryItem).toHaveBeenCalledWith(
			{ id: "task" },
			{ expectedSession: fixture.task },
		)
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it.each([true, false])("restart consent resumes only when accepted: %s", async (accept) => {
		const failure = new Error("Missing commit")
		fixture.taskDouble.checkpointRestore.mockRejectedValueOnce(failure)
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(
			accept ? ("common:checkpoints.restart" as never) : undefined,
		)
		await expect(handleCheckpointRestoreOperation(fixture.config)).rejects.toBe(failure)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"common:errors.checkpoint_restore_failed: Missing commit",
		)
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			"common:checkpoints.restart_after_restore_failure",
			"common:checkpoints.restart",
		)
		expect(fixture.providerDouble.restartTaskIfCurrent).toHaveBeenCalledTimes(accept ? 1 : 0)
		if (accept) expect(fixture.providerDouble.restartTaskIfCurrent).toHaveBeenCalledWith(fixture.task)
		expect(saveTaskMessages).not.toHaveBeenCalled()
	})

	it.each(["already stopped", "changed before prompt", "changed during prompt", "restore succeeded", "abort failed"])(
		"does not restart when %s",
		async (scenario) => {
			const failure = new Error("Failure")
			fixture.taskDouble.checkpointRestore.mockRejectedValueOnce(failure)
			if (scenario === "already stopped") fixture.taskDouble.abort = true
			if (scenario === "changed before prompt")
				fixture.providerDouble.getCurrentTask.mockReturnValue({ taskId: "task" } as Task)
			if (scenario === "changed during prompt") {
				vi.mocked(vscode.window.showWarningMessage).mockImplementationOnce(async () => {
					fixture.providerDouble.getCurrentTask.mockReturnValue({ taskId: "task" } as Task)
					return "common:checkpoints.restart" as never
				})
			}
			if (scenario === "restore succeeded") {
				fixture.taskDouble.checkpointRestore.mockReset().mockResolvedValue(undefined)
				vi.mocked(saveTaskMessages).mockRejectedValueOnce(failure)
			}
			if (scenario === "abort failed") fixture.taskDouble.abortTask.mockRejectedValueOnce(failure)
			await expect(handleCheckpointRestoreOperation(fixture.config)).rejects.toBe(failure)
			expect(fixture.providerDouble.restartTaskIfCurrent).not.toHaveBeenCalled()
			if (scenario !== "changed during prompt") expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
		},
	)

	it("logs restart errors while retaining the restore failure", async () => {
		const failure = new Error("Restore failure")
		const restartError = new Error("Restart failure")
		fixture.taskDouble.checkpointRestore.mockRejectedValueOnce(failure)
		fixture.providerDouble.restartTaskIfCurrent.mockRejectedValueOnce(restartError)
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce("common:checkpoints.restart" as never)
		await expect(handleCheckpointRestoreOperation(fixture.config)).rejects.toBe(failure)
		expect(console.error).toHaveBeenCalledWith(
			"Failed to restart task after checkpoint restore failure:",
			restartError,
		)
	})

	it.each([false, true])("failed edit clears only its owner, newer edit present: %s", async (newerEdit) => {
		const failure = "Invalid reference"
		let newerOwner: PendingEditOperation | undefined
		fixture.taskDouble.checkpointRestore.mockImplementationOnce(async () => {
			if (newerEdit)
				newerOwner = fixture.providerDouble.setPendingEditOperation("task-task", {
					editedContent: "Newer edit",
				})
			throw failure
		})
		await expect(
			handleCheckpointRestoreOperation({
				...fixture.config,
				operation: "edit",
				editData: { editedContent: "Failed edit", images: ["image"], apiConversationHistoryIndex: 0 },
			}),
		).rejects.toBe(failure)
		const owner = fixture.providerDouble.setPendingEditOperation.mock.results[0].value
		expect(fixture.providerDouble.clearPendingEditOperation).toHaveBeenCalledWith("task-task", owner)
		expect(fixture.pending.get("task-task")).toBe(newerOwner)
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
		expect(fixture.taskDouble.abortTask).not.toHaveBeenCalled()
		expect(saveTaskMessages).not.toHaveBeenCalled()
	})

	it("successful edit passes replacement owner and images without saving or aborting", async () => {
		await handleCheckpointRestoreOperation({
			...fixture.config,
			operation: "edit",
			editData: { editedContent: "Replacement", images: ["image"], apiConversationHistoryIndex: 0 },
		})
		const owner = fixture.pending.get("task-task")
		expect(owner).toMatchObject({ editedContent: "Replacement", images: ["image"], ready: false })
		expect(fixture.taskDouble.checkpointRestore).toHaveBeenCalledWith({
			ts: 1,
			commitHash: "a".repeat(40),
			mode: "restore",
			operation: "edit",
			pendingEditOwner: owner,
		})
		expect(fixture.providerDouble.clearPendingEditOperation).not.toHaveBeenCalled()
		expect(fixture.taskDouble.abortTask).not.toHaveBeenCalled()
		expect(saveTaskMessages).not.toHaveBeenCalled()
	})

	it("an abort wait timeout does not manufacture restart consent for a running task", async () => {
		fixture.taskDouble.abortTask.mockImplementationOnce(async () => {})
		vi.mocked(pWaitFor).mockRejectedValueOnce(new Error("timeout"))
		fixture.taskDouble.checkpointRestore.mockRejectedValueOnce(new Error("failure"))
		await expect(handleCheckpointRestoreOperation(fixture.config)).rejects.toThrow("failure")
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})
})
