import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type { Task } from "../core/task/Task"
import { attemptCompletionTool } from "../core/tools/AttemptCompletionTool"
import { readTaskMessages, saveTaskMessages } from "../core/task-persistence/taskMessages"
import { makeLinkProvider, runNewTask } from "./helpers/subtask-links"

let globalStoragePath: string
let snapshotPath: string
const corruptSnapshot = "{corrupt parent snapshot"

beforeEach(async () => {
	globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "roo-subtask-caller-"))
	snapshotPath = path.join(globalStoragePath, "tasks", "parent", "ui_messages.json")
	await fs.mkdir(path.dirname(snapshotPath), { recursive: true })
	await fs.writeFile(snapshotPath, corruptSnapshot)
})

afterEach(async () => {
	vi.restoreAllMocks()
	await fs.rm(globalStoragePath, { recursive: true, force: true })
})

it("SL-13/S4 real corrupt disk stamp save logs rejection; approved child starts with in-memory stamp", async () => {
	const setup = makeLinkProvider([], globalStoragePath)
	const callbacks = await runNewTask(setup, "Do work")
	expect(callbacks.handleError).not.toHaveBeenCalled()
	expect(setup.provider.log).toHaveBeenCalledWith(expect.stringContaining("Failed to stamp childTaskId"))
	expect(setup.child.start).toHaveBeenCalledOnce()
	expect(setup.parent.clineMessages.at(-1)?.childTaskId).toBe("child")
	expect(setup.stack).toEqual([setup.child])
	expect(await fs.readFile(snapshotPath, "utf8")).toBe(corruptSnapshot)
	await expect(
		saveTaskMessages({ messages: setup.parent.clineMessages, taskId: "parent", globalStoragePath }),
	).rejects.toThrow()
	expect(await fs.readFile(snapshotPath, "utf8")).toBe(corruptSnapshot)
})

it("SL-14 real AttemptCompletionTool catches corrupt result-save rejection and asks normal completion without reopening parent", async () => {
	const setup = makeLinkProvider([], globalStoragePath)
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
	const child = {
		taskId: "child",
		parentTaskId: "parent",
		consecutiveMistakeCount: 0,
		providerRef: { deref: () => setup.provider },
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		emitFinalTokenUsageUpdate: vi.fn(),
		emit: vi.fn(),
		getTokenUsage: vi.fn().mockReturnValue({}),
		toolUsage: {},
	}
	setup.stack.splice(0, 1, child)
	const callbacks = {
		askApproval: vi.fn(),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		askFinishSubTaskApproval: vi.fn().mockResolvedValue(true),
		toolDescription: () => "completion",
	}
	await attemptCompletionTool.handle(
		child as unknown as Task,
		{
			type: "tool_use",
			name: "attempt_completion",
			params: {},
			partial: false,
			nativeArgs: { result: "Done" },
		},
		callbacks,
	)
	expect(callbacks.askFinishSubTaskApproval).toHaveBeenCalledOnce()
	expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Skipping delegation."))
	expect(child.say).toHaveBeenCalledWith("completion_result", "Done", undefined, false)
	expect(child.ask).toHaveBeenCalledWith("completion_result", "", false)
	expect(callbacks.handleError).not.toHaveBeenCalled()
	expect(setup.provider.createTaskWithHistoryItem).not.toHaveBeenCalled()
	expect(setup.provider.removeClineFromStack).not.toHaveBeenCalled()
	expect(setup.provider.updateTaskHistory).not.toHaveBeenCalled()
	expect(setup.reopenedParent.resumeAfterDelegation).not.toHaveBeenCalled()
	expect(setup.stack).toEqual([child])
	expect(await fs.readFile(snapshotPath, "utf8")).toBe(corruptSnapshot)

	await fs.unlink(snapshotPath)
	await saveTaskMessages({ messages: [], taskId: "parent", globalStoragePath })
	expect(await readTaskMessages({ taskId: "parent", globalStoragePath })).toEqual([])
})
