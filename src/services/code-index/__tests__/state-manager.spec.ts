import "./mock-code-index-log"
import { codeIndexLog } from "../code-index-log"
import { CodeIndexStateManager } from "../state-manager"

vi.mock("vscode", () => ({
	EventEmitter: class {
		event = vi.fn()
		fire = vi.fn()
		dispose = vi.fn()
	},
}))

beforeEach(() => vi.clearAllMocks())

it("logs state and message changes with source and attempt context", () => {
	const state = new CodeIndexStateManager()
	state.setDiagnosticContext({ source: "manager", attempt: 12 })
	state.setSystemState("Indexing", "Starting", "start-request")
	expect(codeIndexLog.info).toHaveBeenLastCalledWith("State transition", {
		oldState: "Standby",
		newState: "Indexing",
		message: "Starting",
		source: "start-request",
		attempt: 12,
	})
	state.setSystemState("Indexing", "Starting")
	expect(codeIndexLog.info).toHaveBeenCalledOnce()
	state.setSystemState("Standby")
	expect(codeIndexLog.info).toHaveBeenLastCalledWith("State transition", {
		oldState: "Indexing",
		newState: "Standby",
		message: "Ready.",
		source: "manager",
		attempt: 12,
	})
	expect(state.getCurrentStatus()).not.toHaveProperty("attempt")
})

it.each(["blocks", "files"])("preserves attempt and default context when %s progress supplies a source", (unit) => {
	const state = new CodeIndexStateManager()
	state.setDiagnosticContext({ source: "manager", attempt: 57 })
	const source = unit === "blocks" ? "scan" : "changed-file-batch"
	if (unit === "blocks") state.reportBlockIndexingProgress(1, 3, source)
	else state.reportFileQueueProgress(1, 3, "file.ts", source)
	expect(codeIndexLog.info).toHaveBeenLastCalledWith(
		"State transition",
		expect.objectContaining({ source, attempt: 57, newState: "Indexing" }),
	)
	state.setSystemState("Standby")
	expect(codeIndexLog.info).toHaveBeenLastCalledWith(
		"State transition",
		expect.objectContaining({ source: "manager", attempt: 57, newState: "Standby" }),
	)
})

it.each(["blocks", "files"])("logs progress entry into Indexing but not per-%s success", (unit) => {
	const state = new CodeIndexStateManager()
	state.setDiagnosticContext({ source: "scan", attempt: "attempt-2" })
	const progress =
		unit === "blocks"
			? (processed: number) => state.reportBlockIndexingProgress(processed, 3)
			: (processed: number) => state.reportFileQueueProgress(processed, 3, "file.ts")
	progress(1)
	progress(2)
	expect(codeIndexLog.info).toHaveBeenCalledOnce()
	expect(codeIndexLog.info).toHaveBeenCalledWith(
		"State transition",
		expect.objectContaining({
			oldState: "Standby",
			newState: "Indexing",
			attempt: "attempt-2",
		}),
	)
	state.setSystemState("Stopping", "Stopping")
	vi.mocked(codeIndexLog.info).mockClear()
	progress(3)
	expect(state.state).toBe("Stopping")
	expect(codeIndexLog.info).not.toHaveBeenCalled()
})
