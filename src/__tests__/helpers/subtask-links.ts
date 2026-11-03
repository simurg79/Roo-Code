import type { ClineMessage, HistoryItem } from "@roo-code/types"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { newTaskTool } from "../../core/tools/NewTaskTool"
import type { Task } from "../../core/task/Task"

export function newTaskRequest(ts: number, content: unknown = "Do work", childTaskId?: string): ClineMessage {
	return {
		ts,
		type: "ask",
		ask: "tool",
		text: JSON.stringify({ tool: "newTask", mode: "Different displayed mode", content }),
		childTaskId,
	}
}

export function makeLinkProvider(messages: ClineMessage[], globalStoragePath = "/storage") {
	const history: HistoryItem = {
		id: "parent",
		number: 1,
		ts: 1,
		task: "Parent",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		status: "active",
	}
	const parent = {
		taskId: "parent",
		clineMessages: messages,
		consecutiveMistakeCount: 0,
		flushPendingToolResultsToHistory: vi.fn().mockResolvedValue(true),
		providerRef: { deref: () => provider },
	}
	const child = { taskId: "child", start: vi.fn() }
	const reopenedParent = {
		taskId: "parent",
		overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
		overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
	}
	const stack: unknown[] = [parent]
	const provider: ClineProvider = Object.assign(Object.create(ClineProvider.prototype), {
		clineStack: stack,
		contextProxy: { globalStorageUri: { fsPath: globalStoragePath } },
		getState: vi.fn().mockResolvedValue({ customModes: [] }),
		removeClineFromStack: vi.fn(async () => {
			stack.pop()
		}),
		handleModeSwitch: vi.fn().mockResolvedValue(undefined),
		createTask: vi.fn(async () => {
			stack.push(child)
			return child
		}),
		getTaskWithId: vi.fn(async (taskId: string) => ({ historyItem: { ...history, id: taskId } })),
		updateTaskHistory: vi.fn().mockResolvedValue(undefined),
		createTaskWithHistoryItem: vi.fn().mockResolvedValue(reopenedParent),
		emit: vi.fn(),
		log: vi.fn(),
	})
	return { provider, parent, child, reopenedParent, stack }
}

export async function runNewTask(setup: ReturnType<typeof makeLinkProvider>, message: string, approved = true) {
	const callbacks = {
		askApproval: vi.fn(async (_kind: string, text?: string) => {
			const request: ClineMessage = { ts: 20, type: "ask", ask: "tool", text }
			setup.parent.clineMessages.push(request)
			return approved
		}),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
	}
	await newTaskTool.handle(
		setup.parent as unknown as Task,
		{
			type: "tool_use",
			name: "new_task",
			params: {},
			partial: false,
			nativeArgs: { mode: "code", message },
		},
		callbacks,
	)
	return callbacks
}

export const delegation = { parentTaskId: "parent", message: "Do work", initialTodos: [], mode: "code" }
