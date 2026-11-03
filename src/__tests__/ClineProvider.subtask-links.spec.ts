import type { ClineMessage } from "@roo-code/types"

vi.mock("../core/task-persistence/taskMessages", async (importOriginal) => ({
	...(await importOriginal<typeof import("../core/task-persistence/taskMessages")>()),
	readTaskMessages: vi.fn().mockResolvedValue([]),
}))
vi.mock("../core/task-persistence", async (importOriginal) => ({
	...(await importOriginal<typeof import("../core/task-persistence")>()),
	readApiMessages: vi.fn().mockResolvedValue([]),
	saveApiMessages: vi.fn().mockResolvedValue(undefined),
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
}))

import { readTaskMessages } from "../core/task-persistence/taskMessages"
import { saveTaskMessages } from "../core/task-persistence"
import { delegation, makeLinkProvider, newTaskRequest, runNewTask } from "./helpers/subtask-links"

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(readTaskMessages).mockResolvedValue([])
})

it("S1/S3 stamps only the newest matching request in memory before saving and starting", async () => {
	const messages: ClineMessage[] = [
		newTaskRequest(1),
		newTaskRequest(2),
		{ ts: 3, type: "say", say: "text", text: "Working" },
		{ ts: 4, type: "ask", ask: "tool", text: "invalid JSON" },
		{ ts: 5, type: "ask", ask: "tool", text: JSON.stringify({ tool: "readFile" }) },
	]
	const setup = makeLinkProvider(messages.map((row) => ({ ...row })))
	vi.mocked(readTaskMessages).mockResolvedValue(messages)
	vi.mocked(saveTaskMessages).mockImplementationOnce(async () => {
		expect(setup.parent.clineMessages[1].childTaskId).toBe("child")
		expect(setup.child.start).not.toHaveBeenCalled()
	})
	await setup.provider.delegateParentAndOpenChild(delegation)
	expect(messages[0].childTaskId).toBeUndefined()
	expect(messages[1].childTaskId).toBe("child")
	expect(saveTaskMessages).toHaveBeenCalledWith({ messages, taskId: "parent", globalStoragePath: "/storage" })
	expect(setup.child.start).toHaveBeenCalledOnce()
	expect(setup.provider.log).not.toHaveBeenCalled()
	expect(setup.stack).toEqual([setup.child])
})

it.each<ClineMessage>([
	{ ts: 3, type: "say", say: "text", text: newTaskRequest(0).text },
	{ ts: 3, type: "ask", ask: "followup", text: newTaskRequest(0).text },
	{ ts: 3, type: "ask", ask: "tool", text: "null" },
	{ ts: 3, type: "ask", ask: "tool", text: "{invalid" },
	{ ts: 3, type: "ask", ask: "tool", text: JSON.stringify({ tool: "readFile" }) },
])("S3 skips unrelated newer messages: %j", async (newer) => {
	const setup = makeLinkProvider([newTaskRequest(1), newer])
	await setup.provider.delegateParentAndOpenChild(delegation)
	expect(setup.parent.clineMessages[0].childTaskId).toBe("child")
	expect(newer.childTaskId).toBeUndefined()
})

it.each([
	newTaskRequest(2, "Other work"),
	newTaskRequest(2, undefined, "existing"),
	newTaskRequest(2, 42),
	newTaskRequest(2, null),
	{ ...newTaskRequest(2), text: JSON.stringify({ tool: "newTask" }) },
	newTaskRequest(2, "Do work", ""),
])("S3 newest nonmatching, malformed-content or stamped request blocks older match: %j", async (newest) => {
	const previousStamp = newest.childTaskId
	const setup = makeLinkProvider([newTaskRequest(1), newest])
	await setup.provider.delegateParentAndOpenChild(delegation)
	expect(setup.parent.clineMessages[0].childTaskId).toBeUndefined()
	expect(newest.childTaskId).toBe(previousStamp)
	expect(saveTaskMessages).not.toHaveBeenCalled()
	expect(setup.child.start).toHaveBeenCalledOnce()
})

it("S1 no request means no stamp write", async () => {
	const setup = makeLinkProvider([])
	await setup.provider.delegateParentAndOpenChild(delegation)
	expect(saveTaskMessages).not.toHaveBeenCalled()
})

it.each([
	{ raw: "see \\@file", delegated: "see \\@file" },
	{ raw: "see \\\\@file", delegated: "see \\@file" },
	{ raw: "see \\\\\\@file", delegated: "see \\\\@file" },
	{ raw: "a\\b @c", delegated: "a\\b @c" },
])("SL-11/S2 real NewTaskTool stamps literal escape table: %j", async ({ raw, delegated }) => {
	const setup = makeLinkProvider([newTaskRequest(1, "Rejected earlier request")])
	const callbacks = await runNewTask(setup, raw)
	expect(callbacks.handleError).not.toHaveBeenCalled()
	expect(setup.provider.createTask).toHaveBeenCalledWith(delegated, undefined, setup.parent, {
		initialTodos: [],
		initialStatus: "active",
		startTask: false,
	})
	const request = setup.parent.clineMessages.at(-1)!
	expect(JSON.parse(request.text!).content).toBe(raw)
	expect(request.childTaskId).toBe("child")
	expect(setup.parent.clineMessages[0].childTaskId).toBeUndefined()
	expect(saveTaskMessages).toHaveBeenCalledOnce()
})

it("S4 real NewTaskTool rejection does not create a child or stamp either request", async () => {
	const setup = makeLinkProvider([newTaskRequest(1)])
	const callbacks = await runNewTask(setup, "Do work", false)
	expect(callbacks.handleError).not.toHaveBeenCalled()
	expect(setup.provider.createTask).not.toHaveBeenCalled()
	expect(setup.parent.clineMessages.every((row) => row.childTaskId === undefined)).toBe(true)
	expect(saveTaskMessages).not.toHaveBeenCalled()
	expect(setup.stack).toEqual([setup.parent])
})

it.each(["read", "write"])("S4 child still starts after stamp %s failure", async (operation) => {
	const setup = makeLinkProvider([newTaskRequest(1)])
	if (operation === "read") vi.mocked(readTaskMessages).mockRejectedValueOnce(new Error("read failed"))
	else vi.mocked(saveTaskMessages).mockRejectedValueOnce(new Error("write failed"))
	await setup.provider.delegateParentAndOpenChild(delegation)
	expect(setup.child.start).toHaveBeenCalledOnce()
	expect(setup.provider.log).toHaveBeenCalledWith(expect.stringContaining("Failed to stamp childTaskId"))
	if (operation === "write") expect(setup.parent.clineMessages[0].childTaskId).toBe("child")
})

it.each([undefined, "child", "earlier-child", ""])(
	"S5 reuses only identical immediately preceding result with absent/equal identity: %s",
	async (previousChildId) => {
		const previous: ClineMessage = {
			ts: 1,
			type: "say",
			say: "subtask_result",
			text: "Done",
			childTaskId: previousChildId,
		}
		vi.mocked(readTaskMessages).mockResolvedValue([previous])
		const setup = makeLinkProvider([])
		await setup.provider.reopenParentFromDelegation({
			parentTaskId: "parent",
			childTaskId: "child",
			completionResultSummary: "Done",
		})
		const saved = vi.mocked(saveTaskMessages).mock.calls[0][0].messages
		const reused = previousChildId === undefined || previousChildId === "child"
		expect(saved).toHaveLength(reused ? 1 : 2)
		expect(saved.at(-1)).toMatchObject({ say: "subtask_result", text: "Done", childTaskId: "child" })
		if (reused) expect(saved[0]).toBe(previous)
		else expect(saved[0].childTaskId).toBe(previousChildId)
		expect(setup.reopenedParent.overwriteClineMessages).toHaveBeenCalledWith(saved)
	},
)

it.each<ClineMessage>([
	{ ts: 2, type: "say", say: "text", text: "Done" },
	{ ts: 2, type: "ask", ask: "completion_result", text: "Done" },
	{ ts: 2, type: "say", say: "subtask_result", text: "Different", childTaskId: "child" },
])("S5 appends instead of searching backwards or reusing different text/type: %j", async (last) => {
	const previous: ClineMessage = { ts: 1, type: "say", say: "subtask_result", text: "Done", childTaskId: "child" }
	vi.mocked(readTaskMessages).mockResolvedValue([previous, last])
	const setup = makeLinkProvider([])
	await setup.provider.reopenParentFromDelegation({
		parentTaskId: "parent",
		childTaskId: "child",
		completionResultSummary: "Done",
	})
	const saved = vi.mocked(saveTaskMessages).mock.calls[0][0].messages
	expect(saved).toHaveLength(3)
	expect(saved.at(-1)).toMatchObject({ say: "subtask_result", text: "Done", childTaskId: "child" })
})
