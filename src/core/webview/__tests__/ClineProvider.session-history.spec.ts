import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import type { HistoryItem } from "@roo-code/types"
import { ClineProvider } from "../ClineProvider"
import { Task } from "../../task/Task"
import * as TaskModule from "../../task/Task"
import { TaskHistoryStore } from "../../task-persistence/TaskHistoryStore"
import { readTaskMessages } from "../../task-persistence/taskMessages"
import { resolveResumeTarget } from "../../task-persistence/sessionHistory"
import { ShadowCheckpointService } from "../../../services/checkpoints/ShadowCheckpointService"
import { webviewMessageHandler } from "../webviewMessageHandler"

vi.mock("../../../i18n", () => ({ t: (key: string) => key }))
vi.mock("vscode", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vscode")>()
	return {
		...actual,
		window: {
			...actual.window,
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			showErrorMessage: vi.fn(),
		},
	}
})

function item(id: string, changes: Partial<HistoryItem> = {}): HistoryItem {
	return { id, number: 1, ts: 1, task: id, tokensIn: 0, tokensOut: 0, totalCost: 0, ...changes }
}

const chain = [
	item("A", { status: "delegated", awaitingChildId: "B", childIds: ["B"] }),
	item("B", { parentTaskId: "A", status: "delegated", awaitingChildId: "C", childIds: ["C"] }),
	item("C", { parentTaskId: "B", status: "active", mode: "architect" }),
]

describe("session history backend", () => {
	let storagePath: string
	let store: TaskHistoryStore
	let provider: ClineProvider
	let opened: HistoryItem[]

	function makeTask(historyItem: HistoryItem): Task {
		const task = Object.assign(Object.create(Task.prototype), {
			taskId: historyItem.id,
			instanceId: `instance-${historyItem.id}`,
			parentTaskId: historyItem.parentTaskId,
			rootTaskId: historyItem.rootTaskId,
			taskNumber: historyItem.number,
			globalStoragePath: storagePath,
			workspacePath: storagePath,
			_taskApiConfigName: "saved-profile",
			_taskMode: historyItem.mode || "code",
			initialStatus: historyItem.status,
			providerRef: new WeakRef(provider),
			toolUsage: {},
			clineMessages: [{ ts: 1, type: "say", say: "text", text: historyItem.task }],
			emit: vi.fn(),
			debouncedEmitTokenUsage: vi.fn(),
			handleWebviewAskResponse: vi.fn(),
		}) as Task
		task.abortTask = vi.fn(async () => {
			expect(await (task as any).saveClineMessages()).toBe(true)
		})
		return task
	}

	function setCurrent(id?: string) {
		;(provider as any).clineStack = id ? [makeTask(store.get(id)!)] : []
		return provider.getCurrentTask()
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.spyOn(ShadowCheckpointService, "deleteTask").mockResolvedValue(undefined)
		storagePath = await fs.mkdtemp(path.join(os.tmpdir(), "roo-session-history-"))
		store = new TaskHistoryStore(storagePath)
		// No watchers are needed; retain the real store lock and disk writes.
		;(store as any).resolveInitialized()
		provider = Object.assign(Object.create(ClineProvider.prototype), {
			taskHistoryStore: store,
			taskHistoryStoreInitialized: true,
			clineStack: [],
			taskEventListeners: new Map(),
			contextProxy: { globalStorageUri: { fsPath: storagePath } },
			log: vi.fn(),
			postStateToWebview: vi.fn(),
			postMessageToWebview: vi.fn(),
			getState: vi.fn().mockResolvedValue({ maxImageFileSize: 5, maxTotalImageSize: 20 }),
		})
		opened = []
		provider.createTaskWithHistoryItem = vi.fn(async (historyItem) => {
			await provider.removeClineFromStack()
			opened.push(historyItem)
			const task = makeTask(historyItem)
			;(provider as any).clineStack.push(task)
			return task
		})
		for (const entry of chain) {
			await store.upsert(entry)
		}
	})

	afterEach(async () => {
		await store.flushIndex()
		store.dispose()
		await store.flushIndex()
		await fs.rm(storagePath, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	it("SH-01/02: mark/reopen changes only the root completion field and survives real task saves", async () => {
		const task = setCurrent("A")!
		const original = structuredClone(store.getAll())
		await provider.markSessionCompleted("C")
		expect(store.get("A")).toEqual({
			...original.find((entry) => entry.id === "A"),
			sessionCompletedAt: expect.any(Number),
		})
		expect(store.get("B")).toEqual(original.find((entry) => entry.id === "B"))
		expect(task.abortTask).not.toHaveBeenCalled()
		const timestamp = store.get("A")!.sessionCompletedAt
		const persisted = new TaskHistoryStore(storagePath)
		await persisted.invalidate("A")
		expect(persisted.get("A")!.sessionCompletedAt).toBe(timestamp)
		persisted.dispose()
		await persisted.flushIndex()
		expect(await (task as any).saveClineMessages()).toBe(true)
		expect(store.get("A")!.sessionCompletedAt).toBe(timestamp)
		await provider.reopenSession("B")
		expect(store.get("A")!.sessionCompletedAt).toBeUndefined()
		expect(store.get("A")!.awaitingChildId).toBe("B")
		expect(task.abortTask).not.toHaveBeenCalled()
		expect(opened).toEqual([])
		const reloaded = new TaskHistoryStore(storagePath)
		await reloaded.invalidate("A")
		expect(reloaded.get("A")!.sessionCompletedAt).toBeUndefined()
		reloaded.dispose()
		await reloaded.flushIndex()
	})

	it("SH-05: inspecting A preserves the continuation and restores C's saved mode and relationships", async () => {
		setCurrent("C")
		await provider.showTaskWithId("A")
		expect(store.get("B")!.awaitingChildId).toBe("C")
		await provider.resumeSession("A", "unsent")
		expect(opened.map((entry) => entry.id)).toEqual(["A", "C"])
		expect(opened[1]).toMatchObject({ mode: "architect", parentTaskId: "B" })
		expect(provider.postMessageToWebview).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "resumeSessionInputUsed" }),
		)
	})

	it("SH-06: creating a new top-level task preserves the saved nested continuation", async () => {
		const previous = setCurrent("C")!
		const created = makeTask(item("new-task", { status: "active" }))
		created.start = vi.fn()
		const constructor = vi.spyOn(TaskModule, "Task").mockImplementation(function () {
			return created
		})
		provider.setValues = vi.fn()
		provider.getState = vi
			.fn()
			.mockResolvedValue({ apiConfiguration: {}, organizationAllowList: { allowAll: true } })
		provider.addClineToStack = vi.fn(async (task) => {
			;(provider as any).clineStack.push(task)
		})
		expect(await provider.createTask("new work")).toBe(created)
		expect(constructor).toHaveBeenCalledWith(expect.objectContaining({ task: "new work", parentTask: undefined }))
		expect(previous.abortTask).toHaveBeenCalledOnce()
		expect(created.start).toHaveBeenCalledOnce()
		expect(provider.getCurrentTask()).toBe(created)
		expect(store.get("A")).toMatchObject({ status: "delegated", awaitingChildId: "B" })
		expect(store.get("B")).toMatchObject({ status: "delegated", awaitingChildId: "C" })
		constructor.mockRestore()
		await provider.resumeSession("A")
		expect(opened.at(-1)?.id).toBe("C")
	})

	it.each(["leave", "clear", "reload", "dispose"])("SH-06: %s preserves nested continuation", async (operation) => {
		setCurrent("C")
		if (operation === "clear") {
			await provider.clearTask()
		} else if (operation === "dispose") {
			Object.assign(provider, {
				pendingOperations: new Map(),
				webviewDisposables: [],
				disposables: [],
				removeAllListeners: vi.fn(),
			})
			await provider.dispose()
		} else {
			await provider.removeClineFromStack()
		}
		if (operation === "reload") {
			await store.flushIndex()
			const reloaded = new TaskHistoryStore(storagePath)
			for (const entry of chain) {
				await reloaded.invalidate(entry.id)
			}
			expect(resolveResumeTarget("A", new Map(reloaded.getAll().map((entry) => [entry.id, entry])))).toEqual({
				taskId: "C",
			})
			reloaded.dispose()
			await reloaded.flushIndex()
		}
		await provider.resumeSession("A")
		expect(opened.at(-1)?.id).toBe("C")
	})

	it.each(["C", "B", undefined])(
		"SH-08/10: deletion repairs B when current is %s without reopening it",
		async (currentId) => {
			const task = setCurrent(currentId)
			await provider.deleteTaskWithId("C")
			expect(store.get("B")).toMatchObject({ status: "active", awaitingChildId: undefined })
			expect(store.get("C")).toBeUndefined()
			expect(opened).toEqual([])
			if (currentId === "B") {
				expect(task!.abortTask).toHaveBeenCalledOnce()
				expect(provider.getCurrentTask()).toBeUndefined()
				const saved = await readTaskMessages({ taskId: "B", globalStoragePath: storagePath })
				expect(saved).toEqual(task!.clineMessages)
				await provider.showTaskWithId("B")
				expect(await (provider.getCurrentTask() as any).saveClineMessages()).toBe(true)
				expect(store.get("B")!.status).toBe("active")
			}
		},
	)

	it("SH-09: cascade-deleting B with C current repairs A", async () => {
		setCurrent("C")
		await provider.deleteTaskWithId("B")
		expect(store.get("A")).toMatchObject({ status: "active", awaitingChildId: undefined })
		expect(store.get("B")).toBeUndefined()
		expect(store.get("C")).toBeUndefined()
	})

	it("SH-11: parallel deletion cannot resurrect a deleted parent", async () => {
		await Promise.all([provider.deleteTaskWithId("B"), provider.deleteTaskWithId("C")])
		expect(store.get("B")).toBeUndefined()
		expect(store.get("C")).toBeUndefined()
	})

	it.each([
		{ status: "active" as const, awaitingChildId: "C" },
		{ status: "delegated" as const, awaitingChildId: "other" },
	])("SH-12: deletion leaves unrelated parent metadata alone (%s)", async (changes) => {
		await store.upsert({ ...store.get("B")!, ...changes })
		const original = store.get("B")
		await provider.deleteTaskWithId("C")
		expect(store.get("B")).toEqual(original)
	})

	it("SH-12: repair errors are logged without preventing deletion", async () => {
		vi.spyOn(store, "updateIfPresent").mockRejectedValueOnce(new Error("storage unavailable"))
		await provider.deleteTaskWithId("C")
		expect(provider.log).toHaveBeenCalledWith(expect.stringContaining("Failed to repair parent B"))
		expect(store.get("C")).toBeUndefined()
	})

	it.each([
		["typed", "continue here", undefined, "messageResponse"],
		["images only", undefined, ["image"], "messageResponse"],
		["button", undefined, undefined, "yesButtonClicked"],
	] as const)(
		"SH-15: %s answers only the current target resume ask then confirms",
		async (_name, input, images, response) => {
			const task = setCurrent("C")!
			task.resumableAsk = { ts: 2, type: "ask", ask: "resume_task" }
			await provider.resumeSession("A", input, images ? [...images] : undefined)
			expect(task.handleWebviewAskResponse).toHaveBeenCalledWith(response, input, images)
			expect(provider.postMessageToWebview).toHaveBeenCalledWith({ type: "resumeSessionInputUsed", text: "C" })
			expect(vi.mocked(task.handleWebviewAskResponse).mock.invocationCallOrder[0]).toBeLessThan(
				vi.mocked(provider.postMessageToWebview).mock.invocationCallOrder[0],
			)
		},
	)

	it.each(["A", "C"])("SH-16: fallback with %s open survives real close and subsequent saves", async (currentId) => {
		await store.delete("B")
		const old = setCurrent(currentId)!
		await provider.resumeSession("A", "not used")
		expect(old.abortTask).toHaveBeenCalledOnce()
		expect(store.get("A")).toMatchObject({ status: "active", awaitingChildId: undefined })
		expect(await (provider.getCurrentTask() as any).saveClineMessages()).toBe(true)
		expect(store.get("A")!.status).toBe("active")
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("common:session_history.resume_fallback")
		expect(provider.postMessageToWebview).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "resumeSessionInputUsed" }),
		)
		vi.mocked(vscode.window.showWarningMessage).mockClear()
		await provider.resumeSession("A")
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it.each(["tool", undefined, "resume_completed_task"] as const)(
		"SH-17: does not answer a current %s ask",
		async (ask) => {
			const task = setCurrent("C")!
			task.interactiveAsk = ask ? { ts: 2, type: "ask", ask } : undefined
			await provider.resumeSession("A", "not used")
			expect(task.handleWebviewAskResponse).not.toHaveBeenCalled()
			expect(provider.postMessageToWebview).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: "resumeSessionInputUsed" }),
			)
		},
	)

	it("completed session declines Resume and editing without changing state", async () => {
		await provider.markSessionCompleted("A")
		const task = setCurrent("C")!
		task.resumableAsk = { ts: 2, type: "ask", ask: "resume_task" }
		const original = structuredClone(store.getAll())
		await provider.resumeSession("C", "not used")
		expect(await provider.guardSessionEdit("C")).toBe(false)
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("common:session_history.reopen_first")
		expect(store.getAll()).toEqual(original)
		expect(task.handleWebviewAskResponse).not.toHaveBeenCalled()
		expect(task.abortTask).not.toHaveBeenCalled()
		expect(opened).toEqual([])
	})

	it("SH-18/19: delegated edit opens C with a notice, but finished child editing is allowed", async () => {
		setCurrent("B")
		expect(await provider.guardSessionEdit("B")).toBe(false)
		expect(opened.at(-1)?.id).toBe("C")
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("common:session_history.edit_not_sent")
		await store.upsert({ ...store.get("C")!, status: "completed" })
		expect(await provider.guardSessionEdit("C")).toBe(true)
	})

	it("routes session actions and keeps the task id separate from input", async () => {
		const resume = vi.spyOn(provider, "resumeSession").mockResolvedValue(undefined)
		await webviewMessageHandler(provider, { type: "markSessionCompleted", text: "B" })
		expect(store.get("A")!.sessionCompletedAt).toEqual(expect.any(Number))
		await webviewMessageHandler(provider, { type: "reopenSession", text: "C" })
		expect(store.get("A")!.sessionCompletedAt).toBeUndefined()
		await webviewMessageHandler(provider, { type: "resumeSession", text: "A", input: "actual input" })
		expect(resume).toHaveBeenCalledWith("A", "actual input", expect.any(Array))
	})

	it.each(["markSessionCompleted", "reopenSession", "resumeSession"] as const)(
		"F1: %s on a just-deleted task does not reject from the message handler",
		async (type) => {
			await expect(webviewMessageHandler(provider, { type, text: "deleted-task" })).resolves.toBeUndefined()
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.share_task_not_found")
			expect(provider.log).toHaveBeenCalledWith(expect.stringContaining(`Failed to handle ${type}`))
		},
	)

	it("F2/R15: fallback whose root repair finds nothing still opens the root with a message", async () => {
		await store.delete("B")
		vi.spyOn(store, "updateIfPresent").mockResolvedValueOnce(undefined)
		await provider.resumeSession("A")
		expect(opened.map((entry) => entry.id)).toEqual(["A"])
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("common:session_history.resume_fallback")
	})

	it("N1: edit confirm on a current task without a history record does not reject", async () => {
		;(provider as any).clineStack = [makeTask(item("unsaved-task"))]
		await expect(
			webviewMessageHandler(provider, { type: "editMessageConfirm", messageTs: 1, text: "edited" }),
		).resolves.toBeUndefined()
	})

	it("getTaskWithId rejects absent metadata but tolerates missing conversation files", async () => {
		await expect(provider.getTaskWithId("missing")).rejects.toThrow("Task not found")
		await expect(provider.getTaskWithId("C")).resolves.toMatchObject({
			historyItem: store.get("C"),
			apiConversationHistory: [],
		})
	})
})
