import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ChatRowContent, getDelegatedChildTaskId } from "../ChatRow"
import type { HistoryItem, ClineMessage } from "@roo-code/types"

// Share the native renderer's React instance when Vite loads chat dependencies.
vi.mock("react", async () => {
	const { createRequire } = await import("node:module")
	return createRequire(import.meta.url)("react")
})

vi.mock("../ChatView", () => ({ MAX_IMAGES_PER_MESSAGE: 20 }))
vi.mock("../../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown?: string }) => <div>{markdown}</div>,
}))

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

function renderChatRow(message: ClineMessage, currentTaskItem?: Partial<HistoryItem>, clineMessages?: ClineMessage[]) {
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

function newTask(ts: number, childTaskId?: string): ClineMessage {
	return {
		ts,
		type: "ask",
		ask: "tool",
		text: JSON.stringify({ tool: "newTask", mode: "code", content: "Implement feature X" }),
		childTaskId,
	}
}

function subtaskResult(ts: number, childTaskId?: string): ClineMessage {
	return { ts, type: "say", say: "subtask_result", text: "Identical summary", childTaskId }
}

function expectSubtaskLink(childTaskId: string) {
	fireEvent.click(screen.getByRole("button", { name: "Go to subtask" }))
	expect(mockPostMessage).toHaveBeenCalledTimes(1)
	expect(mockPostMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: childTaskId })
}

function expectNoSubtaskLink() {
	expect(screen.queryByRole("button", { name: "Go to subtask" })).not.toBeInTheDocument()
	expect(mockPostMessage).not.toHaveBeenCalled()
}

function interveningMessages(): ClineMessage[] {
	return [
		{ ts: 1100, type: "say", say: "text", text: "Working", childTaskId: "unrelated-child" },
		{ ts: 1200, type: "ask", ask: "tool", text: "not valid JSON" },
		{ ts: 1300, type: "ask", ask: "tool", text: JSON.stringify({ tool: "switchMode", mode: "code" }) },
	]
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
			renderChatRow(newTaskMessage, { childIds: ["child-task-123"] }, [
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

		it("S9: latest result uses completedByChildId before positional inference across intervening messages", () => {
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
				text: "stale-child",
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

	describe("S7–S12 approved navigation", () => {
		it.each(["request", "result"] as const)(
			"S7: own %s stamp survives missing conversation and metadata",
			(row) => {
				const message = row === "request" ? newTask(1000, "own-child") : subtaskResult(1000, "own-child")
				renderChatRow(message, undefined, [])
				expectSubtaskLink("own-child")
			},
		)

		it.each(["request", "result"] as const)("S7: own %s stamp beats contradictory context", (row) => {
			const message = row === "request" ? newTask(2000, "own-child") : subtaskResult(2000, "own-child")
			renderChatRow(message, { childIds: ["wrong-child"], completedByChildId: "wrong-child" }, [
				newTask(1000, "preceding-child"),
				{ ...message, childTaskId: "stale-context-child" },
			])
			expectSubtaskLink("own-child")
		})

		it.each([0, 1])("S7: out-of-order identical result %s keeps its own child", (resultIndex) => {
			const results = [subtaskResult(3000, "second-child"), subtaskResult(4000, "first-child")]
			renderChatRow(
				results[resultIndex],
				{ childIds: ["first-child", "second-child"], completedByChildId: "second-child" },
				[newTask(1000, "first-child"), newTask(2000, "second-child"), ...results],
			)
			expectSubtaskLink(results[resultIndex].childTaskId!)
		})

		it("S8: latest preceding request stamp wins across malformed and unrelated intervening messages", () => {
			const result = subtaskResult(2000)
			renderChatRow(result, { childIds: ["positional-child"], completedByChildId: "wrong-child" }, [
				newTask(500, "older-child"),
				newTask(1000, "preceding-child"),
				...interveningMessages(),
				result,
			])
			expectSubtaskLink("preceding-child")
		})

		it("S8: an unstamped newer request blocks borrowing an older request stamp", () => {
			const result = subtaskResult(3000)
			renderChatRow(result, { completedByChildId: "completed-child" }, [
				newTask(1000, "older-child"),
				newTask(2000),
				result,
			])
			expectSubtaskLink("completed-child")
		})

		it("S9: latest result uses completedByChildId before a shifted legacy position even with a later request", () => {
			const result = subtaskResult(3000)
			renderChatRow(
				result,
				{ childIds: ["completed-child", "running-child"], completedByChildId: "completed-child" },
				[newTask(1000), newTask(2000), result, newTask(4000)],
			)
			expectSubtaskLink("completed-child")
		})

		it("S9: earlier result without a position cannot use completedByChildId", () => {
			const result = subtaskResult(1000)
			renderChatRow(result, { completedByChildId: "latest-child" }, [result, subtaskResult(2000)])
			expectNoSubtaskLink()
		})

		it.each(["rejected", "approved", "pending"] as const)(
			"S10: %s request cannot steal another approval's child",
			(row) => {
				const rejected = newTask(1000)
				const approved = newTask(2000, "approved-child")
				const pending = newTask(4000)
				renderChatRow(
					{ rejected, approved, pending }[row],
					{
						childIds: ["approved-child"],
						completedByChildId: "approved-child",
					},
					[rejected, approved, ...interveningMessages(), subtaskResult(3000), pending],
				)
				if (row === "approved") expectSubtaskLink("approved-child")
				else expectNoSubtaskLink()
			},
		)

		it("S10: earlier result rejects a positional child owned by a later request", () => {
			const result = subtaskResult(2000)
			renderChatRow(result, { childIds: ["owned-child"], completedByChildId: "owned-child" }, [
				newTask(1000),
				result,
				newTask(3000, "owned-child"),
				subtaskResult(4000),
			])
			expectNoSubtaskLink()
		})

		it("S10: pending legacy request after completion does not borrow completedByChildId or delegatedToId", () => {
			const pending = newTask(3000)
			renderChatRow(
				pending,
				{
					childIds: ["first-child"],
					completedByChildId: "first-child",
					delegatedToId: "first-child",
				},
				[newTask(1000), subtaskResult(2000), pending],
			)
			expectNoSubtaskLink()
		})

		it.each([0, 1])("S10: legacy request %s keeps its positional child", (requestIndex) => {
			const requests = [newTask(1000), newTask(2000)]
			const childIds = ["first-child", "second-child"]
			renderChatRow(requests[requestIndex], { childIds }, [requests[0], ...interveningMessages(), requests[1]])
			expectSubtaskLink(childIds[requestIndex])
		})

		it.each([
			{ ts: 1500, type: "say", say: "text", text: newTask(0).text, childTaskId: "lookalike-child" },
			{ ts: 1500, type: "ask", ask: "followup", text: newTask(0).text, childTaskId: "lookalike-child" },
		] as ClineMessage[])(
			"S8/S10: non-request newTask JSON neither counts nor supplies a stamp: %j",
			(lookalike) => {
				const result = subtaskResult(2000)
				renderChatRow(result, { childIds: ["first-child", "second-child"] }, [newTask(1000), lookalike, result])
				expectSubtaskLink("first-child")
			},
		)

		it.each([false, true])(
			"S11: absent unstamped result cannot invent a link with preceding request %s",
			(includeRequest) => {
				renderChatRow(
					subtaskResult(2000),
					{ childIds: ["child"], completedByChildId: "child" },
					includeRequest ? [newTask(1000, "preceding-child")] : [],
				)
				expectNoSubtaskLink()
			},
		)

		it.each([false, true])(
			"S11: unresolved result without metadata and with preceding request %s has no link",
			(includeRequest) => {
				const result = subtaskResult(2000)
				renderChatRow(result, undefined, [...(includeRequest ? [newTask(1000)] : []), result])
				expectNoSubtaskLink()
			},
		)

		it.each([undefined, "child"])(
			"S12: adjacent result suppresses a genuinely resolved request control with stamp %s",
			(childTaskId) => {
				const request = newTask(1000, childTaskId)
				renderChatRow(request, { childIds: ["child"] }, [request, subtaskResult(2000, childTaskId)])
				expectNoSubtaskLink()
			},
		)

		it.each([undefined, "child"])(
			"S12: intervening messages preserve request control with stamp %s",
			(childTaskId) => {
				const request = newTask(1000, childTaskId)
				renderChatRow(request, { childIds: ["child"] }, [
					request,
					...interveningMessages(),
					subtaskResult(2000),
				])
				expectSubtaskLink("child")
			},
		)

		it("scaling: resolver scan cost stays linear over a 1x/2x/4x/8x history ladder", () => {
			const measurements = [1, 2, 4, 8].map((scale) => {
				const requests = Array.from({ length: 1000 * scale }, (_, requestIndex) => newTask(requestIndex))
				const result = subtaskResult(requests.length)
				const messages = [...requests, result, subtaskResult(requests.length + 1)]
				const childIds = Array.from({ length: requests.length }, (_, requestIndex) => `child-${requestIndex}`)
				for (let iteration = 0; iteration < 5; iteration++) {
					getDelegatedChildTaskId(messages, result, childIds, "latest-child")
				}
				const samples = Array.from({ length: 5 }, () => {
					let resolvedChildTaskId: string | undefined
					const started = performance.now()
					for (let iteration = 0; iteration < 10; iteration++) {
						resolvedChildTaskId = getDelegatedChildTaskId(messages, result, childIds, "latest-child")
					}
					const duration = performance.now() - started
					expect(resolvedChildTaskId).toBe(childIds.at(-1))
					return duration
				}).sort((first, second) => first - second)
				return samples[2]
			})
			console.info(
				`Resolver ladder milliseconds: ${measurements.map((duration) => duration.toFixed(2)).join(", ")}`,
			)
			console.info(`Resolver 4x/1x ratio: ${(measurements[2] / measurements[0]).toFixed(2)}`)
			expect(measurements[2] / measurements[0]).toBeLessThan(8)
			expect(measurements[3] / measurements[0]).toBeLessThan(16)
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
