import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import type { ClineApiReqInfo, HistoryItem } from "@roo-code/types"
import { Task } from "../../task/Task"
import { ClineProvider, type PendingEditOperation } from "../../webview/ClineProvider"
import { webviewMessageHandler } from "../../webview/webviewMessageHandler"
import { handleCheckpointRestoreOperation } from "../../webview/checkpointRestoreHandler"
import { readApiMessages, readTaskMessages } from "../../task-persistence"

vi.mock("p-wait-for", () => ({ default: vi.fn(async () => {}) }))
vi.mock("../../../i18n", () => ({
	t: (key: string, options?: { error?: string }) => (options ? `${key}: ${options.error}` : key),
}))
vi.mock("vscode", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vscode")>()
	return { ...actual, window: { ...actual.window, showErrorMessage: vi.fn(), showWarningMessage: vi.fn() } }
})

const checkpointHash = "a".repeat(40)
const deletedUsage: ClineApiReqInfo = { tokensIn: 100, tokensOut: 50, cacheWrites: 3, cacheReads: 7, cost: 0.02 }

function createFixture(globalStoragePath: string) {
	// Keep real Task guards, rewind, metrics and persistence; omit unrelated constructor services.
	const task: Task = Object.assign(Object.create(Task.prototype), {
		taskId: "checkpoint-runtime",
		instanceId: "stopped-session",
		taskNumber: 1,
		globalStoragePath,
		workspacePath: globalStoragePath,
		_taskApiConfigName: "saved-profile",
		_taskMode: "code",
		abort: false,
		abandoned: false,
		isInitialized: true,
		lastMessageTs: 123,
		toolUsage: {},
		clineMessages: [
			{ ts: 1, type: "say", say: "text", text: "Original task" },
			{ ts: 2, type: "say", say: "user_feedback", text: "Latest prompt" },
			{ ts: 3, type: "say", say: "checkpoint_saved", text: checkpointHash },
			{ ts: 4, type: "say", say: "api_req_started", text: JSON.stringify(deletedUsage) },
			{ ts: 5, type: "ask", ask: "completion_result", text: "Done" },
		],
		apiConversationHistory: [
			{ ts: 1, role: "user", content: "Original task" },
			{ ts: 3, role: "user", content: "Latest prompt" },
			{ ts: 4, role: "assistant", content: "Done" },
		],
		enableCheckpoints: true,
		checkpointService: { restoreCheckpoint: vi.fn(async () => {}) },
		emit: vi.fn(),
		debouncedEmitTokenUsage: vi.fn(),
		abortTask: vi.fn(async () => {
			task.abort = true
		}),
	})
	const resumedConversations: Task["clineMessages"][] = []
	const providerDouble = {
		getCurrentTask: vi.fn(() => task),
		log: vi.fn(),
		postMessageToWebview: vi.fn(async () => {}),
		postStateToWebviewWithoutTaskHistory: vi.fn(async () => {}),
		updateTaskHistory: vi.fn(async (_historyItem: HistoryItem) => {}),
		getTaskWithId: vi.fn(async () => ({ historyItem: { id: task.taskId } })),
		createTaskWithHistoryItem: vi.fn(async (_item: unknown, _options: unknown) => {
			resumedConversations.push(await readTaskMessages({ taskId: task.taskId, globalStoragePath }))
			return task
		}),
		cancelTask: vi.fn(async (options: { rehydrate?: boolean; expectedSession?: Task }) => {
			expect(options.expectedSession).toBe(task)
			await task.abortTask()
			if (options.rehydrate !== false) {
				await providerDouble.createTaskWithHistoryItem({ id: task.taskId }, { expectedSession: task })
			}
		}),
		restartTaskIfCurrent: vi.fn(),
		contextProxy: { globalStorageUri: { fsPath: globalStoragePath } },
	}
	const provider = providerDouble as unknown as ClineProvider
	task.providerRef = new WeakRef(provider)
	return { task, provider, providerDouble, resumedConversations }
}

describe("stopped Task checkpoint runtime integration", () => {
	let globalStoragePath: string
	let fixture: ReturnType<typeof createFixture>
	beforeEach(async () => {
		vi.clearAllMocks()
		globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "roo-checkpoint-runtime-"))
		fixture = createFixture(globalStoragePath)
		vi.spyOn(console, "error").mockImplementation(() => {})
	})
	afterEach(async () => {
		vi.restoreAllMocks()
		await fs.rm(globalStoragePath, { recursive: true, force: true })
	})

	async function runRestore(route: "direct" | "completion" | "delete" | "preview") {
		if (route === "delete") {
			return handleCheckpointRestoreOperation({
				provider: fixture.provider,
				currentCline: fixture.task,
				messageTs: 3,
				messageIndex: 2,
				checkpoint: { hash: checkpointHash },
				operation: "delete",
			})
		}
		return webviewMessageHandler(
			fixture.provider,
			route === "completion"
				? { type: "completionCheckpointRestore" }
				: {
						type: "checkpointRestore",
						payload: {
							ts: 3,
							commitHash: checkpointHash,
							mode: route === "preview" ? "preview" : "restore",
						},
					},
		)
	}

	it.each(["direct", "completion", "delete"] as const)(
		"%s restores on a stopped Task and persists usage before its single resume",
		async (route) => {
			await runRestore(route)
			await vi.waitFor(() => expect(fixture.providerDouble.createTaskWithHistoryItem).toHaveBeenCalledOnce())
			await vi.waitFor(() => expect(fixture.resumedConversations).toHaveLength(1))
			const saved = await readTaskMessages({ taskId: fixture.task.taskId, globalStoragePath })
			expect(saved).toEqual(fixture.task.clineMessages)
			expect(saved.map((message) => message.say)).toEqual(["text", "user_feedback", "api_req_deleted"])
			expect(JSON.parse(saved[2].text!)).toEqual(deletedUsage)
			expect(fixture.resumedConversations[0]).toEqual(saved)
			expect(await readApiMessages({ taskId: fixture.task.taskId, globalStoragePath })).toEqual([
				{ ts: 1, role: "user", content: "Original task" },
			])
			expect(fixture.providerDouble.updateTaskHistory).toHaveBeenLastCalledWith(
				expect.objectContaining({ tokensIn: 0, tokensOut: 0, totalCost: 0, apiConfigName: "saved-profile" }),
			)
			expect(fixture.providerDouble.cancelTask).toHaveBeenCalledTimes(route === "delete" ? 0 : 2)
			expect(fixture.task.abort).toBe(true)
			expect(fixture.task.lastMessageTs).toBe(123)
			await expect(fixture.task.say("text", "Late output")).rejects.toThrow("aborted")
			await expect(fixture.task.ask("resume_task")).rejects.toThrow("aborted")
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
			expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
		},
	)

	it("file-only preview restores files without rewinding or recording deleted usage", async () => {
		const messages = structuredClone(fixture.task.clineMessages)
		const history = structuredClone(fixture.task.apiConversationHistory)
		await runRestore("preview")
		await vi.waitFor(() => expect(fixture.resumedConversations).toHaveLength(1))
		expect(fixture.task.checkpointService!.restoreCheckpoint).toHaveBeenCalledWith(checkpointHash)
		expect(fixture.task.clineMessages).toEqual(messages)
		expect(fixture.task.apiConversationHistory).toEqual(history)
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it.each(["direct", "completion", "delete"] as const)(
		"%s retains the real missing-commit failure without rewind or usage adjustment",
		async (route) => {
			const failure = new Error(`Missing checkpoint ${checkpointHash}; no files changed`)
			vi.mocked(fixture.task.checkpointService!.restoreCheckpoint).mockRejectedValueOnce(failure)
			const messages = structuredClone(fixture.task.clineMessages)
			const history = structuredClone(fixture.task.apiConversationHistory)
			if (route === "delete") await expect(runRestore(route)).rejects.toBe(failure)
			else await runRestore(route)
			expect(fixture.task.clineMessages).toEqual(messages)
			expect(fixture.task.apiConversationHistory).toEqual(history)
			expect(fixture.task.enableCheckpoints).toBe(true)
			expect(fixture.providerDouble.createTaskWithHistoryItem).not.toHaveBeenCalled()
			expect(fixture.providerDouble.updateTaskHistory).not.toHaveBeenCalled()
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				`common:errors.checkpoint_restore_failed: ${failure.message}`,
			)
			expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(route === "delete" ? 1 : 0)
		},
	)

	it("delete resume failure after real restore success does not offer restart consent", async () => {
		const failure = new Error("Resume setup failed")
		fixture.providerDouble.createTaskWithHistoryItem.mockRejectedValueOnce(failure)
		await expect(runRestore("delete")).rejects.toBe(failure)
		const saved = await readTaskMessages({ taskId: fixture.task.taskId, globalStoragePath })
		expect(saved.at(-1)?.say).toBe("api_req_deleted")
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
		expect(fixture.providerDouble.restartTaskIfCurrent).not.toHaveBeenCalled()
	})

	it("owned resume rejection logs the initialization error and releases through real cancelTask finally", async () => {
		const owner = { ready: false } as PendingEditOperation
		const releaseOwnedResume = vi.fn()
		Object.assign(fixture.provider, {
			markPendingEditReady: vi.fn(() => true),
			beginOwnedResume: vi.fn(),
			cancelTask: ClineProvider.prototype.cancelTask.bind(fixture.provider),
			cancelTaskInner: vi.fn(async () => {
				throw new Error("Owned resume initialization timeout")
			}),
			releaseOwnedResume,
		})
		fixture.task.abort = true
		await fixture.task.checkpointRestore({
			ts: 3,
			commitHash: checkpointHash,
			mode: "restore",
			operation: "edit",
			pendingEditOwner: owner,
		})
		await vi.waitFor(() => expect(releaseOwnedResume).toHaveBeenCalledExactlyOnceWith(owner))
		expect(fixture.providerDouble.log).toHaveBeenCalledWith(
			`[checkpointRestore] failed to resume task ${fixture.task.taskId}: Error: Owned resume initialization timeout`,
		)
		expect(fixture.task.clineMessages.at(-1)?.say).toBe("api_req_deleted")
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it("logs background resume rejection without misreporting a successful restore", async () => {
		fixture.providerDouble.cancelTask.mockImplementation(async (options) => {
			await fixture.task.abortTask()
			if (options.rehydrate !== false) throw new Error("Resume initialization timeout")
		})
		await runRestore("direct")
		await vi.waitFor(() =>
			expect(fixture.providerDouble.log).toHaveBeenCalledWith(
				`[checkpointRestore] failed to resume task ${fixture.task.taskId}: Error: Resume initialization timeout`,
			),
		)
		expect(fixture.task.clineMessages.at(-1)?.say).toBe("api_req_deleted")
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})
})
