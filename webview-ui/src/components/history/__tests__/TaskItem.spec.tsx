import { render, screen, fireEvent } from "@/utils/test-utils"

import TaskItem from "../TaskItem"
import { vscode } from "@/utils/vscode"

vi.mock("@src/utils/vscode")
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/utils/format", () => ({
	formatTimeAgo: vi.fn(() => "2 hours ago"),
	formatDate: vi.fn(() => "January 15 at 2:30 PM"),
	formatLargeNumber: vi.fn((num: number) => num.toString()),
}))

const mockTask = {
	id: "1",
	number: 1,
	task: "Test task",
	ts: Date.now(),
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.002,
	workspace: "/test/workspace",
}

describe("TaskItem", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("keeps row inspection separate from Resume and confirmed completion", () => {
		render(<TaskItem item={mockTask} variant="full" />)
		fireEvent.click(screen.getByTestId("task-content"))
		expect(vscode.postMessage).toHaveBeenLastCalledWith({ type: "showTaskWithId", text: "1" })
		vi.mocked(vscode.postMessage).mockClear()
		fireEvent.click(screen.getByRole("button", { name: "history:resumeSession" }))
		expect(vscode.postMessage).toHaveBeenCalledTimes(1)
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "resumeSession", text: "1" })
		vi.mocked(vscode.postMessage).mockClear()
		fireEvent.click(screen.getByRole("button", { name: "history:markSessionCompleted" }))
		expect(screen.getByText("history:completeSessionMessage")).toBeInTheDocument()
		expect(vscode.postMessage).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "history:cancel" }))
		expect(vscode.postMessage).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "history:markSessionCompleted" }))
		fireEvent.click(screen.getByRole("button", { name: "history:confirmSessionCompleted" }))
		expect(vscode.postMessage).toHaveBeenCalledTimes(1)
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "markSessionCompleted", text: "1" })
	})

	it("identifies completed sessions and reopens without resuming or inspecting", () => {
		render(<TaskItem item={{ ...mockTask, sessionCompletedAt: 123 }} variant="full" />)
		expect(screen.getByText("history:sessionCompleted")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "history:markSessionCompleted" })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "history:reopenSession" }))
		expect(vscode.postMessage).toHaveBeenCalledTimes(1)
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "reopenSession", text: "1" })
	})

	it("does not offer session actions on child search results", () => {
		render(<TaskItem item={{ ...mockTask, parentTaskId: "root" }} variant="full" />)
		expect(screen.queryByRole("button", { name: "history:resumeSession" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "history:markSessionCompleted" })).not.toBeInTheDocument()
	})

	it("renders task information", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		expect(screen.getByText("Test task")).toBeInTheDocument()
		expect(screen.getByText("$0.00")).toBeInTheDocument() // Component shows $0.00 for small amounts
	})

	it("handles selection in selection mode", () => {
		const onToggleSelection = vi.fn()
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={onToggleSelection}
				isSelectionMode={true}
			/>,
		)

		const checkbox = screen.getByRole("checkbox")
		fireEvent.click(checkbox)

		expect(onToggleSelection).toHaveBeenCalledWith("1", true)
	})

	it("shows action buttons", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		// Should show copy and export buttons
		expect(screen.getByTestId("copy-prompt-button")).toBeInTheDocument()
		expect(screen.getByTestId("export")).toBeInTheDocument()
	})

	it("displays time ago information", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		// Should display time ago format
		expect(screen.getByText(/ago/)).toBeInTheDocument()
	})

	it("applies hover effect class", () => {
		render(
			<TaskItem
				item={mockTask}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)

		const taskItem = screen.getByTestId("task-item-1")
		expect(taskItem).toHaveClass("hover:text-vscode-foreground")
	})
})

// Share the renderer's React instance across Vite and native dependencies.
vi.mock("react", async () => {
	const { createRequire } = await import("node:module")
	const react = createRequire(import.meta.url)("react")
	return { ...react, default: react }
})
