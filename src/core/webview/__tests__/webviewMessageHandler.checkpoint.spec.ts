import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import type { Task } from "../../task/Task"
import type { ClineProvider } from "../ClineProvider"
import { webviewMessageHandler } from "../webviewMessageHandler"
import { saveTaskMessages } from "../../task-persistence"
import { handleCheckpointRestoreOperation } from "../checkpointRestoreHandler"
import { MessageManager } from "../../message-manager"

import { checkpointRestore, type CheckpointRestoreOptions } from "../../checkpoints"

vi.mock("../../task-persistence", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../task-persistence")>()),
	saveTaskMessages: vi.fn(),
}))
vi.mock("../checkpointRestoreHandler", async (importOriginal) => ({
	...(await importOriginal<typeof import("../checkpointRestoreHandler")>()),
	handleCheckpointRestoreOperation: vi.fn(),
}))
vi.mock("p-wait-for", () => ({ default: vi.fn(async () => {}) }))
vi.mock("../../../i18n", () => ({
	t: (key: string, options?: { error?: string }) => (options ? `${key}: ${options.error}` : key),
	changeLanguage: vi.fn(),
}))
vi.mock("vscode", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vscode")>()
	return { ...actual, window: { ...actual.window, showErrorMessage: vi.fn(), showWarningMessage: vi.fn() } }
})

const checkpointHash = "a".repeat(40)
const latestCheckpointHash = "b".repeat(40)

function createFixture() {
	const taskDouble = {
		taskId: "test-task",
		isInitialized: true,
		abort: false,
		abandoned: false,
		clineMessages: [
			{ ts: 1, type: "say", say: "text", text: "First message" },
			{ ts: 2, type: "say", say: "checkpoint_saved", text: checkpointHash },
			{ ts: 3, type: "say", say: "user_feedback", text: "Latest prompt" },
			{ ts: 4, type: "say", say: "checkpoint_saved", text: latestCheckpointHash },
		] satisfies Task["clineMessages"],
		apiConversationHistory: [
			{ ts: 1, role: "user", content: [{ type: "text", text: "First message" }] },
		] satisfies Task["apiConversationHistory"],
		checkpointDiff: vi.fn(async (_options: unknown) => {}),
		checkpointRestore: vi.fn(async (_options: CheckpointRestoreOptions) => true),
		overwriteClineMessages: vi.fn(),
		overwriteApiConversationHistory: vi.fn(),
	}
	const task = taskDouble as unknown as Task
	Object.defineProperty(task, "messageManager", { value: new MessageManager(task) })
	const providerDouble = {
		getCurrentTask: vi.fn(() => task as Task | undefined),
		guardSessionEdit: vi.fn(async () => true),
		cancelTask: vi.fn(async (_options: unknown) => {
			taskDouble.abort = true
			taskDouble.abandoned = true
		}),
		restartTaskIfCurrent: vi.fn(async (_session: Task) => true),
		postMessageToWebview: vi.fn(),
		postStateToWebview: vi.fn(),
		customModesManager: { getCustomModes: vi.fn(async () => []) },
		getMcpHub: vi.fn(),
		synchronizeProviderProfiles: vi.fn(async () => {}),
		activateProviderProfile: vi.fn(),
		providerSettingsManager: { listConfig: vi.fn(), hasConfig: vi.fn(), saveConfig: vi.fn() },
		log: vi.fn(),
		isViewLaunched: false,
		contextProxy: { globalStorageUri: { fsPath: "/storage" }, getValue: vi.fn(), setValue: vi.fn() },
		getState: vi.fn(async () => ({ maxImageFileSize: 5, maxTotalImageSize: 20 })),
	}
	providerDouble.restartTaskIfCurrent.mockImplementation(async (session) => {
		if (providerDouble.getCurrentTask() !== session) return false
		providerDouble.getCurrentTask.mockReturnValue({ ...task, abort: false, abandoned: false } as Task)
		return true
	})
	return { task, taskDouble, providerDouble, provider: providerDouble as unknown as ClineProvider }
}

describe("webview checkpoint operations", () => {
	let fixture: ReturnType<typeof createFixture>
	beforeEach(() => {
		vi.clearAllMocks()
		fixture = createFixture()
		vi.spyOn(console, "error").mockImplementation(() => {})
	})
	afterEach(() => vi.restoreAllMocks())
	const restore = () =>
		webviewMessageHandler(fixture.provider, {
			type: "checkpointRestore",
			payload: { ts: 2, commitHash: checkpointHash, mode: "restore" },
		})

	it("validates and cancels before restoring a recorded checkpoint", async () => {
		await restore()
		expect(fixture.providerDouble.cancelTask).toHaveBeenCalledWith({
			expectedSession: fixture.task,
			rehydrate: false,
		})
		expect(fixture.providerDouble.cancelTask.mock.invocationCallOrder[0]).toBeLessThan(
			fixture.taskDouble.checkpointRestore.mock.invocationCallOrder[0],
		)
		expect(fixture.taskDouble.checkpointRestore).toHaveBeenCalledWith({
			ts: 2,
			commitHash: checkpointHash,
			mode: "restore",
		})
		expect(fixture.providerDouble.restartTaskIfCurrent).not.toHaveBeenCalled()
	})

	it.each(["HEAD", "a".repeat(7), "A".repeat(40), "c".repeat(40)])(
		"rejects invalid or foreign hash %s without cancelling",
		async (commitHash) => {
			await webviewMessageHandler(fixture.provider, {
				type: "checkpointRestore",
				payload: { ts: 2, commitHash, mode: "restore" },
			})
			expect(fixture.providerDouble.cancelTask).not.toHaveBeenCalled()
			expect(fixture.taskDouble.checkpointRestore).not.toHaveBeenCalled()
			expect(fixture.providerDouble.restartTaskIfCurrent).not.toHaveBeenCalled()
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"common:errors.checkpoint_restore_failed: common:errors.checkpoint_invalid",
			)
		},
	)

	it("stops after initialization timeout", async () => {
		vi.mocked(pWaitFor).mockRejectedValueOnce(new Error("timeout"))
		await restore()
		expect(fixture.taskDouble.checkpointRestore).not.toHaveBeenCalled()
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.checkpoint_timeout")
		expect(fixture.providerDouble.restartTaskIfCurrent).toHaveBeenCalledExactlyOnceWith(fixture.task)
		expect(fixture.providerDouble.getCurrentTask()).toMatchObject({ abort: false, abandoned: false })
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it.each(["different task", "same task newer session", "no task", "during initialization"])(
		"does not restore after navigation: %s",
		async (scenario) => {
			const replacement =
				scenario === "no task"
					? undefined
					: ({
							taskId: scenario === "different task" ? "other" : fixture.task.taskId,
							isInitialized: true,
						} as Task)
			if (scenario === "during initialization") {
				vi.mocked(pWaitFor).mockImplementationOnce(async () => {
					fixture.providerDouble.getCurrentTask.mockReturnValue(replacement)
				})
			} else {
				fixture.providerDouble.cancelTask.mockImplementationOnce(async () => {
					fixture.providerDouble.getCurrentTask.mockReturnValue(replacement)
				})
			}
			await restore()
			expect(fixture.taskDouble.checkpointRestore).not.toHaveBeenCalled()
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.checkpoint_failed")
			expect(fixture.providerDouble.restartTaskIfCurrent).not.toHaveBeenCalled()
		},
	)

	it("does nothing without an active task", async () => {
		fixture.providerDouble.getCurrentTask.mockReturnValue(undefined)
		await restore()
		expect(fixture.providerDouble.cancelTask).not.toHaveBeenCalled()
	})

	it.each([new Error("Missing commit"), "Repository unavailable"])(
		"exposes the original failure %s without restart consent",
		async (failure) => {
			fixture.taskDouble.checkpointRestore.mockRejectedValueOnce(failure)
			await restore()
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				`common:errors.checkpoint_restore_failed: ${failure instanceof Error ? failure.message : failure}`,
			)
			expect(saveTaskMessages).not.toHaveBeenCalled()
		},
	)

	it.each(["checkpointRestore", "completionCheckpointRestore"] as const)(
		"%s failure resumes the cancelled session without restart consent",
		async (type) => {
			fixture.taskDouble.checkpointRestore.mockRejectedValueOnce(new Error("Missing commit"))
			await webviewMessageHandler(
				fixture.provider,
				type === "checkpointRestore"
					? { type, payload: { ts: 2, commitHash: checkpointHash, mode: "restore" } }
					: { type },
			)
			expect(fixture.providerDouble.cancelTask).toHaveBeenCalledExactlyOnceWith({
				expectedSession: fixture.task,
				rehydrate: false,
			})
			expect(fixture.providerDouble.restartTaskIfCurrent).toHaveBeenCalledExactlyOnceWith(fixture.task)
			expect(fixture.providerDouble.restartTaskIfCurrent.mock.invocationCallOrder[0]).toBeGreaterThan(
				fixture.taskDouble.checkpointRestore.mock.invocationCallOrder[0],
			)
			expect(fixture.providerDouble.getCurrentTask()).not.toBe(fixture.task)
			expect(fixture.providerDouble.getCurrentTask()).toMatchObject({ abort: false, abandoned: false })
			expect(saveTaskMessages).not.toHaveBeenCalled()
			expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
		},
	)

	describe.each(["checkpointRestore", "completionCheckpointRestore"] as const)("%s early returns", (type) => {
		function useRealRestore(scenario: string) {
			const service = { restoreCheckpoint: vi.fn(async () => {}) }
			Object.assign(fixture.task, {
				enableCheckpoints: scenario !== "missing service",
				checkpointService: scenario === "missing service" ? undefined : service,
				providerRef: new WeakRef(fixture.provider),
			})
			fixture.taskDouble.checkpointRestore.mockImplementation((options) =>
				checkpointRestore(fixture.task, options),
			)
			if (scenario === "missing timestamp") {
				vi.mocked(pWaitFor).mockImplementationOnce(async () => {
					const targetTimestamp = type === "checkpointRestore" ? 2 : 4
					fixture.task.clineMessages = fixture.task.clineMessages.map((message) =>
						message.ts === targetTimestamp ? { ...message, ts: 7 } : message,
					)
				})
			}
			return service
		}

		const runRestore = () =>
			webviewMessageHandler(
				fixture.provider,
				type === "checkpointRestore"
					? { type, payload: { ts: 2, commitHash: checkpointHash, mode: "restore" } }
					: { type },
			)

		it.each(["missing service", "missing timestamp"])("resumes once without consent after %s", async (scenario) => {
			const service = useRealRestore(scenario)
			await runRestore()
			expect(service.restoreCheckpoint).not.toHaveBeenCalled()
			expect(fixture.providerDouble.cancelTask).toHaveBeenCalledExactlyOnceWith({
				expectedSession: fixture.task,
				rehydrate: false,
			})
			expect(fixture.providerDouble.restartTaskIfCurrent).toHaveBeenCalledExactlyOnceWith(fixture.task)
			expect(fixture.providerDouble.getCurrentTask()).not.toBe(fixture.task)
			expect(fixture.providerDouble.getCurrentTask()).toMatchObject({ abort: false, abandoned: false })
			expect(fixture.taskDouble.overwriteClineMessages).not.toHaveBeenCalled()
			expect(fixture.taskDouble.overwriteApiConversationHistory).not.toHaveBeenCalled()
			expect(saveTaskMessages).not.toHaveBeenCalled()
			expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
		})

		it.each(["missing service", "missing timestamp"])(
			"does not resume a newer session after %s",
			async (scenario) => {
				useRealRestore(scenario)
				const replacement = createFixture().task
				fixture.taskDouble.checkpointRestore.mockImplementationOnce(async (options) => {
					const restored = await checkpointRestore(fixture.task, options)
					fixture.providerDouble.getCurrentTask.mockReturnValue(replacement)
					return restored
				})
				await runRestore()
				expect(fixture.providerDouble.restartTaskIfCurrent).not.toHaveBeenCalled()
				expect(fixture.providerDouble.getCurrentTask()).toBe(replacement)
				expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
			},
		)
	})

	it.each(["checkpointRestore", "completionCheckpointRestore"] as const)(
		"%s failure never resumes a superseded session",
		async (type) => {
			for (const scenario of ["different task", "same task newer session", "no task"]) {
				fixture = createFixture()
				const replacementFixture = createFixture()
				if (scenario === "different task") replacementFixture.taskDouble.taskId = "other-task"
				const replacement = scenario === "no task" ? undefined : replacementFixture.task
				fixture.taskDouble.checkpointRestore.mockImplementationOnce(async () => {
					fixture.providerDouble.getCurrentTask.mockReturnValue(replacement)
					throw new Error("Session changed during restore")
				})
				await webviewMessageHandler(
					fixture.provider,
					type === "checkpointRestore"
						? { type, payload: { ts: 2, commitHash: checkpointHash, mode: "restore" } }
						: { type },
				)
				expect(fixture.providerDouble.restartTaskIfCurrent).not.toHaveBeenCalled()
				expect(fixture.providerDouble.getCurrentTask()).toBe(replacement)
				expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
			}
		},
	)

	it("logs recovery failure without hiding the restore error or prompting", async () => {
		fixture.taskDouble.checkpointRestore.mockRejectedValueOnce(new Error("Missing commit"))
		fixture.providerDouble.restartTaskIfCurrent.mockRejectedValueOnce(new Error("History unavailable"))
		await expect(restore()).resolves.toBeUndefined()
		expect(fixture.providerDouble.log).toHaveBeenCalledWith(
			"[checkpointRestore] failed to resume task: Error: History unavailable",
		)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"common:errors.checkpoint_restore_failed: Missing commit",
		)
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
	})

	it.each(["deleteMessageConfirm", "editMessageConfirm"] as const)(
		"routes %s through the shared restore handler",
		async (type) => {
			await webviewMessageHandler(fixture.provider, {
				type,
				messageTs: 1,
				text: "Replacement",
				restoreCheckpoint: true,
			})
			expect(handleCheckpointRestoreOperation).toHaveBeenCalledWith(
				expect.objectContaining({
					provider: fixture.provider,
					currentCline: fixture.task,
					checkpoint: { hash: checkpointHash },
					operation: type === "deleteMessageConfirm" ? "delete" : "edit",
				}),
			)
		},
	)
	describe("completion checkpoint actions", () => {
		it.each(["completionCheckpointDiff", "completionCheckpointRestore"] as const)(
			"routes %s to the first checkpoint after the latest prompt, ignoring caller payload",
			async (type) => {
				fixture.task.clineMessages.push(
					{ ts: 5, type: "say", say: "text", text: "Assistant reply" },
					{ ts: 6, type: "say", say: "checkpoint_saved", text: "c".repeat(40) },
					{ ts: 7, type: "ask", ask: "completion_result", text: "" },
				)
				await webviewMessageHandler(fixture.provider, {
					type,
					payload: { ts: 2, commitHash: checkpointHash, mode: "restore" },
				})
				const operation =
					type === "completionCheckpointDiff"
						? fixture.taskDouble.checkpointDiff
						: fixture.taskDouble.checkpointRestore
				expect(operation).toHaveBeenCalledExactlyOnceWith({
					ts: 4,
					commitHash: latestCheckpointHash,
					mode: type === "completionCheckpointDiff" ? "to-current" : "restore",
				})
				if (type === "completionCheckpointRestore") {
					expect(fixture.providerDouble.cancelTask).toHaveBeenCalledWith({
						expectedSession: fixture.task,
						rehydrate: false,
					})
					expect(fixture.providerDouble.cancelTask.mock.invocationCallOrder[0]).toBeLessThan(
						operation.mock.invocationCallOrder[0],
					)
					expect(pWaitFor).toHaveBeenCalledWith(expect.any(Function), { timeout: 3_000 })
				} else {
					expect(fixture.providerDouble.cancelTask).not.toHaveBeenCalled()
				}
			},
		)

		it("uses the initial task's text prompt when there is no feedback", async () => {
			fixture.task.clineMessages = fixture.task.clineMessages.slice(0, 2)
			await webviewMessageHandler(fixture.provider, { type: "completionCheckpointDiff" })
			await webviewMessageHandler(fixture.provider, { type: "completionCheckpointRestore" })
			expect(fixture.taskDouble.checkpointDiff).toHaveBeenCalledWith({
				ts: 2,
				commitHash: checkpointHash,
				mode: "to-current",
			})
			expect(fixture.taskDouble.checkpointRestore).toHaveBeenCalledWith({
				ts: 2,
				commitHash: checkpointHash,
				mode: "restore",
			})
		})

		it.each(["no checkpoint", "newer feedback", "no prompt", "no active task", "empty checkpoint"])(
			"does not compare, restore or cancel with %s",
			async (scenario) => {
				if (scenario === "no active task") {
					fixture.providerDouble.getCurrentTask.mockReturnValue(undefined)
				} else if (scenario === "newer feedback") {
					fixture.task.clineMessages.push({ ts: 5, type: "say", say: "user_feedback", text: "Newest prompt" })
				} else if (scenario === "no prompt") {
					fixture.task.clineMessages = fixture.task.clineMessages.filter(
						(message) => message.say === "checkpoint_saved",
					)
				} else if (scenario === "empty checkpoint") {
					fixture.task.clineMessages[3].text = ""
				} else {
					fixture.task.clineMessages.pop()
				}
				await webviewMessageHandler(fixture.provider, { type: "completionCheckpointDiff" })
				await webviewMessageHandler(fixture.provider, { type: "completionCheckpointRestore" })
				expect(fixture.taskDouble.checkpointDiff).not.toHaveBeenCalled()
				expect(fixture.taskDouble.checkpointRestore).not.toHaveBeenCalled()
				expect(fixture.providerDouble.cancelTask).not.toHaveBeenCalled()
				expect(pWaitFor).not.toHaveBeenCalled()
			},
		)

		it.each(["HEAD", "a".repeat(7), "A".repeat(40)])(
			"rejects invalid completion checkpoint %s before cancellation",
			async (hash) => {
				fixture.task.clineMessages[3].text = hash
				await webviewMessageHandler(fixture.provider, { type: "completionCheckpointRestore" })
				expect(fixture.providerDouble.cancelTask).not.toHaveBeenCalled()
				expect(fixture.taskDouble.checkpointRestore).not.toHaveBeenCalled()
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
					"common:errors.checkpoint_restore_failed: common:errors.checkpoint_invalid",
				)
			},
		)

		it("stops completion restore on initialization timeout", async () => {
			vi.mocked(pWaitFor).mockRejectedValueOnce(new Error("timeout"))
			await webviewMessageHandler(fixture.provider, { type: "completionCheckpointRestore" })
			expect(fixture.providerDouble.cancelTask).toHaveBeenCalledOnce()
			expect(fixture.taskDouble.checkpointRestore).not.toHaveBeenCalled()
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.checkpoint_timeout")
			expect(fixture.providerDouble.restartTaskIfCurrent).toHaveBeenCalledExactlyOnceWith(fixture.task)
			expect(fixture.providerDouble.getCurrentTask()).toMatchObject({ abort: false, abandoned: false })
			expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
		})

		it.each(["different task", "same task newer session", "no task", "during initialization"])(
			"blocks completion restore after cancellation changes the session: %s",
			async (scenario) => {
				const replacement = createFixture()
				replacement.taskDouble.taskId = scenario === "different task" ? "other" : fixture.task.taskId
				const changeSession = async () => {
					fixture.providerDouble.getCurrentTask.mockReturnValue(
						scenario === "no task" ? undefined : replacement.task,
					)
				}
				if (scenario === "during initialization") {
					vi.mocked(pWaitFor).mockImplementationOnce(changeSession)
				} else {
					fixture.providerDouble.cancelTask.mockImplementationOnce(changeSession)
				}
				await webviewMessageHandler(fixture.provider, { type: "completionCheckpointRestore" })
				expect(fixture.taskDouble.checkpointRestore).not.toHaveBeenCalled()
				expect(replacement.taskDouble.checkpointRestore).not.toHaveBeenCalled()
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.checkpoint_failed")
				expect(fixture.providerDouble.restartTaskIfCurrent).not.toHaveBeenCalled()
			},
		)

		it.each([new Error("Missing commit"), "Repository unavailable"])(
			"reports completion failure %s without restart consent",
			async (failure) => {
				fixture.taskDouble.checkpointRestore.mockRejectedValueOnce(failure)
				await webviewMessageHandler(fixture.provider, { type: "completionCheckpointRestore" })
				expect(console.error).toHaveBeenCalledWith(
					"[completionCheckpointRestore] checkpointRestore failed:",
					failure,
				)
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
					`common:errors.checkpoint_restore_failed: ${failure instanceof Error ? failure.message : failure}`,
				)
				expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
				expect(saveTaskMessages).not.toHaveBeenCalled()
			},
		)
	})

	it("completion checkpoint selection scales linearly and matches latest-prompt selection", async () => {
		const measurements: { multiplier: number; visits: number; durationMs: number }[] = []
		for (const multiplier of [1, 2, 4, 8]) {
			let visits = 0
			const messages: Task["clineMessages"] = Array.from({ length: 2_000 * multiplier }, (_, messageIndex) => ({
				ts: messageIndex,
				type: "say",
				get say() {
					visits++
					return "text" as const
				},
			}))
			messages.push(
				{ ts: messages.length, type: "say", say: "user_feedback", text: "Latest prompt" },
				{ ts: messages.length + 1, type: "say", say: "checkpoint_saved", text: latestCheckpointHash },
			)
			fixture.task.clineMessages = messages
			const startedAt = performance.now()
			for (let iteration = 0; iteration < 100; iteration++) {
				await webviewMessageHandler(fixture.provider, { type: "completionCheckpointDiff" })
			}
			measurements.push({ multiplier, visits, durationMs: performance.now() - startedAt })
			expect(fixture.taskDouble.checkpointDiff).toHaveBeenLastCalledWith({
				ts: messages.length - 1,
				commitHash: latestCheckpointHash,
				mode: "to-current",
			})
		}
		console.log("Completion checkpoint benchmark ladder", measurements)
		expect(measurements[2].visits / measurements[0].visits).toBeLessThan(4.01)
		expect(measurements[2].durationMs / measurements[0].durationMs).toBeLessThan(12)
	})

	it("routes first-load synchronization once through the provider with no direct profile writes", async () => {
		await webviewMessageHandler(fixture.provider, { type: "webviewDidLaunch" })
		expect(fixture.providerDouble.synchronizeProviderProfiles).toHaveBeenCalledExactlyOnceWith()
		expect(fixture.providerDouble.synchronizeProviderProfiles.mock.contexts[0]).toBe(fixture.provider)
		expect(fixture.providerDouble.providerSettingsManager.listConfig).not.toHaveBeenCalled()
		expect(fixture.providerDouble.providerSettingsManager.hasConfig).not.toHaveBeenCalled()
		expect(fixture.providerDouble.providerSettingsManager.saveConfig).not.toHaveBeenCalled()
		expect(fixture.providerDouble.activateProviderProfile).not.toHaveBeenCalled()
		expect(fixture.providerDouble.contextProxy.setValue).toHaveBeenCalledExactlyOnceWith("customModes", [])
		expect(fixture.providerDouble.isViewLaunched).toBe(true)
	})

	it("logs failed first-load synchronization without blocking launch", async () => {
		const failure = new Error("Profile storage unavailable")
		fixture.providerDouble.synchronizeProviderProfiles.mockRejectedValueOnce(failure)
		await webviewMessageHandler(fixture.provider, { type: "webviewDidLaunch" })
		expect(fixture.providerDouble.log).toHaveBeenCalledWith(
			`Error list api configuration: ${JSON.stringify(failure, Object.getOwnPropertyNames(failure), 2)}`,
		)
		expect(fixture.providerDouble.isViewLaunched).toBe(true)
	})
})
