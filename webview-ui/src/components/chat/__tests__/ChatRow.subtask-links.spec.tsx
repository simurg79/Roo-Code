import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ChatRowContent } from "../ChatRow"
import type { HistoryItem, ClineMessage } from "@roo-code/types"

// Mock vscode API
const mockPostMessage = vi.fn()
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (msg: unknown) => mockPostMessage(msg),
	},
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:subtasks.wantsToCreate": "Roo wants to create a new subtask",
				"chat:subtasks.resultContent": "Task result",
				"chat:subtasks.goToSubtask": "Go to subtask",
			}
			return map[key] ?? key
		},
		i18n: { exists: () => true },
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Mock extension state context
let mockCurrentTaskItem: Partial<HistoryItem> | undefined = undefined
let mockClineMessages: ClineMessage[] = []

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		alwaysAllowMcp: false,
		currentCheckpoint: null,
		mode: "code",
		apiConfiguration: {},
		clineMessages: mockClineMessages,
		currentTaskItem: mockCurrentTaskItem,
	}),
}))

// Mock useSelectedModel hook
vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({ info: { supportsImages: true } }),
}))

const queryClient = new QueryClient()

function renderChatRow(message: any, currentTaskItem?: Partial<HistoryItem>, clineMessages?: ClineMessage[]) {
	mockCurrentTaskItem = currentTaskItem
	mockClineMessages = clineMessages || [message]

	return render(
		<QueryClientProvider client={queryClient}>
			<ChatRowContent
				message={message}
				isExpanded={false}
				isLast={false}
				isStreaming={false}
				onToggleExpand={() => {}}
				onSuggestionClick={() => {}}
				onBatchFileResponse={() => {}}
				onFollowUpUnmount={() => {}}
				isFollowUpAnswered={false}
			/>
		</QueryClientProvider>,
	)
}

describe("ChatRow - subtask links", () => {
	beforeEach(() => {
		mockPostMessage.mockClear()
	})

	describe("newTask tool", () => {
		it("should display 'Go to subtask' link when currentTaskItem has childIds", () => {
			const message = {
				ts: Date.now(),
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({
					tool: "newTask",
					mode: "code",
					content: "Implement feature X",
				}),
			}

			// childIds maps by index to newTask messages - first newTask gets childIds[0]
			renderChatRow(message, {
				childIds: ["child-task-123"],
			})

			const goToSubtaskButton = screen.getByText("Go to subtask")
			expect(goToSubtaskButton).toBeInTheDocument()

			fireEvent.click(goToSubtaskButton)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "child-task-123",
			})
		})

		it("should display 'Go to subtask' link using index-matched childId for multiple newTasks", () => {
			const message = {
				ts: Date.now(),
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({
					tool: "newTask",
					mode: "architect",
					content: "Design system architecture",
				}),
			}

			// The implementation maps newTask messages to childIds by index
			// Since this is the first (and only) newTask message, it gets childIds[0]
			renderChatRow(message, {
				childIds: ["first-child", "second-child"],
			})

			const goToSubtaskButton = screen.getByText("Go to subtask")
			expect(goToSubtaskButton).toBeInTheDocument()

			fireEvent.click(goToSubtaskButton)

			// First newTask message maps to first childId
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "first-child",
			})
		})

		it("should not display 'Go to subtask' link when no child task exists", () => {
			const message = {
				ts: Date.now(),
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({
					tool: "newTask",
					mode: "code",
					content: "Implement feature X",
				}),
			}

			renderChatRow(message, undefined)

			const goToSubtaskButton = screen.queryByText("Go to subtask")
			expect(goToSubtaskButton).toBeNull()
		})

		it("should not display 'Go to subtask' link when directly followed by subtask_result", () => {
			const newTaskMessage = {
				ts: 1000,
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({
					tool: "newTask",
					mode: "code",
					content: "Implement feature X",
				}),
			}

			const subtaskResultMessage = {
				ts: 1001,
				type: "say" as const,
				say: "subtask_result" as const,
				text: "The subtask has been completed successfully.",
			}

			// Pass both messages in the clineMessages array
			renderChatRow(newTaskMessage, { delegatedToId: "child-task-123" }, [
				newTaskMessage,
				subtaskResultMessage,
			] as ClineMessage[])

			// Button should be hidden because next message is subtask_result
			const goToSubtaskButton = screen.queryByText("Go to subtask")
			expect(goToSubtaskButton).toBeNull()
		})
	})

	describe("subtask_result say message", () => {
		it("should display 'Go to subtask' link when currentTaskItem has completedByChildId", () => {
			const message = {
				ts: Date.now(),
				type: "say" as const,
				say: "subtask_result" as const,
				text: "The subtask has been completed successfully.",
			}

			renderChatRow(message, {
				completedByChildId: "completed-child-456",
			})

			const goToSubtaskButton = screen.getByText("Go to subtask")
			expect(goToSubtaskButton).toBeInTheDocument()

			fireEvent.click(goToSubtaskButton)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "completed-child-456",
			})
		})

		it("should not display 'Go to subtask' link when no completedByChildId exists", () => {
			const message = {
				ts: Date.now(),
				type: "say" as const,
				say: "subtask_result" as const,
				text: "The subtask has been completed successfully.",
			}

			renderChatRow(message, undefined)

			const goToSubtaskButton = screen.queryByText("Go to subtask")
			expect(goToSubtaskButton).toBeNull()
		})

		it("should link to the matching child task, not the last one, when several subtasks completed", () => {
			const newTask = (ts: number) => ({
				ts,
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({ tool: "newTask", mode: "code", content: `Subtask ${ts}` }),
			})
			const subtaskResult = (ts: number) => ({
				ts,
				type: "say" as const,
				say: "subtask_result" as const,
				text: `Result ${ts}`,
			})

			const firstResult = subtaskResult(1001)
			const clineMessages = [
				newTask(1000),
				firstResult,
				newTask(1002),
				subtaskResult(1003),
				newTask(1004),
				subtaskResult(1005),
			] as ClineMessage[]

			renderChatRow(
				firstResult,
				{
					childIds: ["first-child", "second-child", "third-child"],
					// Only ever holds the most recently completed child.
					completedByChildId: "third-child",
				},
				clineMessages,
			)

			fireEvent.click(screen.getByText("Go to subtask"))

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "first-child",
			})
		})

		it("should link to the matching child task when the result is not adjacent to its newTask row", () => {
			const newTaskMessage = {
				ts: 1000,
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({ tool: "newTask", mode: "code", content: "Implement feature X" }),
			}
			const resumeTaskMessage = {
				ts: 1001,
				type: "ask" as const,
				ask: "resume_task" as const,
			}
			const resultMessage = {
				ts: 1002,
				type: "say" as const,
				say: "subtask_result" as const,
				text: "The subtask has been completed successfully.",
			}

			renderChatRow(resultMessage, { childIds: ["only-child"], completedByChildId: "stale-child" }, [
				newTaskMessage,
				resumeTaskMessage,
				resultMessage,
			] as ClineMessage[])

			fireEvent.click(screen.getByText("Go to subtask"))

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "only-child",
			})
		})

		it("should prefer the message's own childTaskId over positional childIds", () => {
			const message = {
				ts: 1002,
				type: "say" as const,
				say: "subtask_result" as const,
				text: "Result",
				childTaskId: "stamped-child",
			}

			renderChatRow(message, { childIds: ["wrong-child"], completedByChildId: "last-child" }, [
				message,
			] as ClineMessage[])

			fireEvent.click(screen.getByText("Go to subtask"))

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "stamped-child",
			})
		})

		it("should link each of several stamped results to its own child", () => {
			const firstResult = {
				ts: 1001,
				type: "say" as const,
				say: "subtask_result" as const,
				text: "Result 1",
				childTaskId: "child-alpha",
			}
			const secondResult = {
				ts: 1003,
				type: "say" as const,
				say: "subtask_result" as const,
				text: "Result 2",
				childTaskId: "child-beta",
			}
			const clineMessages = [firstResult, secondResult] as ClineMessage[]

			renderChatRow(secondResult, { completedByChildId: "child-beta" }, clineMessages)

			fireEvent.click(screen.getByText("Go to subtask"))

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "child-beta",
			})
		})

		it("should resolve an unstamped result via its stamped newTask row", () => {
			const newTaskMessage = {
				ts: 1000,
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({ tool: "newTask", mode: "code", content: "Do work" }),
				childTaskId: "stamped-child",
			}
			const resultMessage = {
				ts: 1001,
				type: "say" as const,
				say: "subtask_result" as const,
				text: "Result",
			}

			renderChatRow(resultMessage, { childIds: [], completedByChildId: "stale-child" }, [
				newTaskMessage,
				resultMessage,
			] as ClineMessage[])

			fireEvent.click(screen.getByText("Go to subtask"))

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "stamped-child",
			})
		})
	})

	describe("rejected delegations", () => {
		it("should link a stamped newTask row correctly when an earlier ask was rejected", () => {
			const rejectedNewTask = {
				ts: 1000,
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({ tool: "newTask", mode: "code", content: "Rejected work" }),
			}
			const approvedNewTask = {
				ts: 1001,
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({ tool: "newTask", mode: "code", content: "Approved work" }),
				childTaskId: "real-child",
			}

			// `childIds` holds one entry while two `newTask` rows exist, so index matching
			// would resolve the approved row to nothing.
			renderChatRow(approvedNewTask, { childIds: ["real-child"] }, [
				rejectedNewTask,
				approvedNewTask,
			] as ClineMessage[])

			fireEvent.click(screen.getByText("Go to subtask"))

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "real-child",
			})
		})
	})
})
