import type { HistoryItem } from "@roo-code/types"
import { historyItemSchema } from "@roo-code/types"
import { resolveResumeTarget, resolveSessionRoot } from "../sessionHistory"

function item(id: string, changes: Partial<HistoryItem> = {}): HistoryItem {
	return { id, number: 1, ts: 1, task: id, tokensIn: 0, tokensOut: 0, totalCost: 0, ...changes }
}

const chain = [
	item("A", { status: "delegated", awaitingChildId: "B" }),
	item("B", { parentTaskId: "A", status: "delegated", awaitingChildId: "C" }),
	item("C", { parentTaskId: "B", status: "active", mode: "architect" }),
	item("old", { parentTaskId: "C", status: "completed", ts: 9999 }),
]
const history = (items: HistoryItem[]) => new Map(items.map((entry) => [entry.id, entry]))

describe("session history resolution", () => {
	it("accepts old records and completion timestamps", () => {
		expect(historyItemSchema.parse(item("A")).sessionCompletedAt).toBeUndefined()
		expect(historyItemSchema.parse(item("A", { sessionCompletedAt: 123 })).sessionCompletedAt).toBe(123)
	})

	it.each(["A", "B", "C", "old"])("SH-03: resolves %s to the active leaf", (startId) => {
		expect(resolveResumeTarget(startId, history(chain))).toEqual({ taskId: "C" })
	})

	it("returns the parent after its child returned, ignoring historical children", () => {
		const returned = chain.map((entry) =>
			entry.id === "B" ? { ...entry, status: "active" as const, awaitingChildId: undefined } : entry,
		)
		expect(resolveResumeTarget("old", history(returned))).toEqual({ taskId: "B" })
	})

	it.each([
		["missingAwaitingChild", [item("A", { status: "delegated" })]],
		["missingChild", [item("A", { status: "delegated", awaitingChildId: "lost" })]],
		["inconsistentChild", [chain[0], item("B", { parentTaskId: "other" })]],
		["inconsistentChild", [chain[0], item("B", { parentTaskId: "A", status: "completed" })]],
		["cycle", [chain[0], item("B", { parentTaskId: "A", status: "delegated", awaitingChildId: "A" })]],
		["cycle", [item("A", { parentTaskId: "B" }), item("B", { parentTaskId: "A" })]],
	] as const)("SH-04: falls back for %s", (fallbackReason, entries) => {
		expect(resolveResumeTarget("A", history([...entries]))).toEqual({ taskId: "A", fallbackReason })
	})

	it("promotes a task with a missing parent and handles standalone sessions", () => {
		const entries = history([item("A", { parentTaskId: "missing" })])
		expect(resolveSessionRoot("A", entries)).toEqual({ taskId: "A" })
		expect(resolveResumeTarget("A", entries)).toEqual({ taskId: "A" })
	})

	it("rejects a missing start without inventing a root", () => {
		expect(() => resolveResumeTarget("missing", history(chain))).toThrow("Task not found")
	})
})
