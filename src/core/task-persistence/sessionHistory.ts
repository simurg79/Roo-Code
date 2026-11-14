import type { HistoryItem } from "@roo-code/types"

export type SessionFallbackReason = "cycle" | "missingChild" | "missingAwaitingChild" | "inconsistentChild"
export type SessionResolution = { taskId: string; fallbackReason?: SessionFallbackReason }

export function resolveSessionRoot(startId: string, historyById: ReadonlyMap<string, HistoryItem>): SessionResolution {
	let current = historyById.get(startId)
	if (!current) {
		throw new Error("Task not found")
	}
	const visited = new Set<string>()
	while (current.parentTaskId) {
		visited.add(current.id)
		if (visited.has(current.parentTaskId)) {
			return { taskId: startId, fallbackReason: "cycle" }
		}
		const parent = historyById.get(current.parentTaskId)
		if (!parent) {
			break
		}
		current = parent
	}
	return { taskId: current.id }
}

export function resolveResumeTarget(startId: string, historyById: ReadonlyMap<string, HistoryItem>): SessionResolution {
	const root = resolveSessionRoot(startId, historyById)
	if (root.fallbackReason) {
		return root
	}
	let current = historyById.get(root.taskId)!
	const visited = new Set<string>()
	while (current.status === "delegated") {
		visited.add(current.id)
		if (!current.awaitingChildId) {
			return { ...root, fallbackReason: "missingAwaitingChild" }
		}
		if (visited.has(current.awaitingChildId)) {
			return { ...root, fallbackReason: "cycle" }
		}
		const child = historyById.get(current.awaitingChildId)
		if (!child) {
			return { ...root, fallbackReason: "missingChild" }
		}
		if (child.parentTaskId !== current.id || child.status === "completed") {
			return { ...root, fallbackReason: "inconsistentChild" }
		}
		current = child
	}
	return { taskId: current.id }
}
