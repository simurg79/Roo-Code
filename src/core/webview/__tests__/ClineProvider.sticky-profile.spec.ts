// npx vitest run core/webview/__tests__/ClineProvider.sticky-profile.spec.ts

import * as vscode from "vscode"
import * as fs from "fs/promises"
import { t } from "../../../i18n"
import { ORGANIZATION_ALLOW_ALL } from "@roo-code/types"
import { ClineProvider } from "../ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import type { HistoryItem } from "@roo-code/types"

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
	WebviewView: vi.fn(),
	Uri: {
		joinPath: vi.fn(),
		file: vi.fn(),
	},
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	commands: {
		executeCommand: vi.fn().mockResolvedValue(undefined),
	},
	window: {
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showOpenDialog: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue([]),
			update: vi.fn(),
		}),
		onDidChangeConfiguration: vi.fn().mockImplementation(() => ({
			dispose: vi.fn(),
		})),
		onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
		appName: "Visual Studio Code",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	version: "1.85.0",
}))

// Create a counter for unique task IDs.
let taskIdCounter = 0

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation((options) => ({
		taskId: options.historyItem?.id || options.taskId || `test-task-id-${++taskIdCounter}`,
		saveClineMessages: vi.fn(),
		clineMessages: [],
		apiConversationHistory: [],
		overwriteClineMessages: vi.fn(),
		overwriteApiConversationHistory: vi.fn(),
		abortTask: vi.fn(),
		handleWebviewAskResponse: vi.fn(),
		resumeFromHistory: vi.fn(),
		isInitialized: true,
		dispose: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		getTaskNumber: vi.fn().mockReturnValue(0),
		setTaskNumber: vi.fn(),
		setParentTask: vi.fn(),
		setRootTask: vi.fn(),
		emit: vi.fn(),
		parentTask: options.parentTask,
		updateApiConfiguration: vi.fn(),
		setTaskApiConfigName: vi.fn(),
		_taskApiConfigName: options.historyItem?.apiConfigName,
		taskApiConfigName: options.historyItem?.apiConfigName,
	})),
}))

vi.mock("../../prompts/sections/custom-instructions")

vi.mock("../../../utils/safeWriteJson")

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => ({
	default: vi.fn().mockImplementation(() => ({
		initializeFilePaths: vi.fn(),
		dispose: vi.fn(),
	})),
}))

vi.mock("../../diff/strategies/multi-search-replace", () => ({
	MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(() => ({
		getName: () => "test-strategy",
		applyDiff: vi.fn(),
	})),
}))

vi.mock("../../../shared/modes", () => ({
	modes: [
		{
			slug: "code",
			name: "Code Mode",
			roleDefinition: "You are a code assistant",
			groups: ["read", "edit"],
		},
		{
			slug: "architect",
			name: "Architect Mode",
			roleDefinition: "You are an architect",
			groups: ["read", "edit"],
		},
	],
	getModeBySlug: vi.fn().mockReturnValue({
		slug: "code",
		name: "Code Mode",
		roleDefinition: "You are a code assistant",
		groups: ["read", "edit"],
	}),
	defaultModeSlug: "code",
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockResolvedValue("mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("fs/promises", () => {
	const filesystem = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue(""),
		readdir: vi.fn().mockResolvedValue([]),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
		access: vi.fn().mockResolvedValue(undefined),
		rm: vi.fn().mockResolvedValue(undefined),
	}
	return { ...filesystem, default: filesystem }
})

vi.mock("../../../utils/storage", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../utils/storage")>()
	return {
		...actual,
		getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => defaultPath),
		getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
		getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	}
})

describe("ClineProvider - Sticky Provider Profile", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: any
	let originalRooCliRuntimeEnv: string | undefined

	beforeEach(async () => {
		vi.clearAllMocks()
		taskIdCounter = 0
		originalRooCliRuntimeEnv = process.env.ROO_CLI_RUNTIME
		delete process.env.ROO_CLI_RUNTIME

		const globalState: Record<string, string | undefined> = {
			mode: "code",
			currentApiConfigName: "default-profile",
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi.fn().mockImplementation((key: string, value: string | undefined) => {
					globalState[key] = value
					return Promise.resolve()
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => {
					secrets[key] = value
					return Promise.resolve()
				}),
				delete: vi.fn().mockImplementation((key: string) => {
					delete secrets[key]
					return Promise.resolve()
				}),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = vi.fn()

		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
				cspSource: "vscode-webview://test-csp-source",
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation((callback) => {
				callback()
				return { dispose: vi.fn() }
			}),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		// Wait for the async TaskHistoryStore initialization to complete
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Mock getMcpHub method
		provider.getMcpHub = vi.fn().mockReturnValue({
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue({ contents: [] }),
			getAllServers: vi.fn().mockReturnValue([]),
		})
	})

	afterEach(() => {
		if (originalRooCliRuntimeEnv === undefined) {
			delete process.env.ROO_CLI_RUNTIME
		} else {
			process.env.ROO_CLI_RUNTIME = originalRooCliRuntimeEnv
		}
	})

	describe("checkpoint recovery core", () => {
		it("CR-04 CR-23 expected owned cancellation rehydrates and submits once", async () => {
			const session = setupRecovery()
			const owner = stage()
			provider.beginOwnedResume(session, owner)
			await provider.cancelTask({ expectedSession: session, pendingEditOwner: owner })
			const accepted = provider.getCurrentTask()!
			expect(accepted).not.toBe(session)
			expect(accepted.handleWebviewAskResponse).toHaveBeenCalledExactlyOnceWith(
				"messageResponse",
				"replacement",
				["image"],
			)
			expect((provider as any).ownedResume).toBeUndefined()
		})

		it("CR-04 owned cancellation releases the marker without consuming the entry when the session changes during abort", async () => {
			const session = setupRecovery()
			const owner = stage()
			provider.beginOwnedResume(session, owner)
			const other = { ...session, instanceId: "other", isStreaming: false, handleWebviewAskResponse: vi.fn() }
			session.abortTask.mockImplementationOnce(async () => {
				;(provider as any).clineStack = [other]
			})
			const createSpy = vi.spyOn(provider, "createTaskWithHistoryItem")
			await provider.cancelTask({ expectedSession: session, pendingEditOwner: owner })
			expect(provider.getCurrentTask()).toBe(other)
			expect(createSpy).not.toHaveBeenCalled()
			expect(other.handleWebviewAskResponse).not.toHaveBeenCalled()
			expect((provider as any).ownedResume).toBeUndefined()
			expect((provider as any).pendingOperations.get("task-recovery")).toBe(owner)
		})

		it("CR-24 rejected older finally does not release a newer owned marker", async () => {
			const session = setupRecovery()
			const older = stage("older")
			provider.beginOwnedResume(session, older)
			const heldAbort = deferred()
			session.abortTask.mockReturnValueOnce(heldAbort.promise)
			const olderResume = provider.createTaskWithHistoryItem(history, {
				expectedSession: session,
				pendingEditOwner: older,
			})
			await flush()
			const newer = stage("newer")
			provider.beginOwnedResume(session, newer)
			heldAbort.resolve()
			expect(await olderResume).toBeUndefined()
			expect((provider as any).ownedResume.attempt).toBe(newer)
			const task = await provider.createTaskWithHistoryItem(history, {
				expectedSession: session,
				pendingEditOwner: newer,
			})
			expect(task!.handleWebviewAskResponse).toHaveBeenCalledExactlyOnceWith("messageResponse", "newer", [
				"image",
			])
		})

		it("CR-22 switch during mode write prevents profile activation", async () => {
			const session = setupRecovery()
			const heldMode = deferred()
			const original = provider.contextProxy.setValue.bind(provider.contextProxy)
			vi.spyOn(provider.contextProxy, "setValue").mockImplementation(async (key, value) => {
				if (key === "mode") await heldMode.promise
				await original(key, value)
			})
			const recovery = provider.createTaskWithHistoryItem(history, { expectedSession: session })
			await flush()
			const accepted = provider.getCurrentTask()!
			const other = { ...session, instanceId: "other" }
			;(provider as any).clineStack = [other]
			heldMode.resolve()
			await recovery
			expect(provider.providerSettingsManager.activateProfile).not.toHaveBeenCalled()
			expect(accepted.updateApiConfiguration).not.toHaveBeenCalled()
			expect(other.updateApiConfiguration).not.toHaveBeenCalled()
		})
		it("CR-20 CR-26 createTask configuration and named activation share one unit", async () => {
			const session = setupRecovery()
			const heldValues = deferred()
			const calls: string[] = []
			vi.spyOn(provider.contextProxy, "setValues").mockImplementationOnce(async () => {
				calls.push("values")
				await heldValues.promise
			})
			vi.mocked(provider.providerSettingsManager.activateProfile).mockImplementationOnce(async () => {
				calls.push("activate")
				return { name: "user", id: "user-id", apiProvider: "anthropic" }
			})
			vi.spyOn(provider, "addClineToStack").mockResolvedValue(undefined)
			const { Task } = await import("../../task/Task")
			vi.mocked(Task).mockImplementationOnce(() => ({ start: vi.fn() }) as any)
			const creating = provider.createTask(
				"new",
				undefined,
				session,
				{},
				{ currentApiConfigName: "user", apiProvider: "anthropic" },
			)
			await flush()
			const later = provider.runProfileUnit(async () => {
				calls.push("later")
			})
			await flush()
			expect(calls).toEqual(["values"])
			heldValues.resolve()
			await Promise.all([creating, later])
			expect(calls).toEqual(["values", "activate", "later"])
		})
		it("CR-01 CR-02 construction cannot expose a rejected replacement", async () => {
			const session = setupRecovery()
			const other = { ...session, instanceId: "new" }
			const { Task } = await import("../../task/Task")
			const constructed = { dispose: vi.fn(), resumeFromHistory: vi.fn() }
			vi.mocked(Task).mockImplementationOnce((options: any) => {
				expect(options.startTask).toBe(false)
				expect(options.onCreated).toBeUndefined()
				;(provider as any).clineStack = [other]
				return constructed as any
			})
			const events = vi.spyOn(provider, "emit")
			expect(await provider.createTaskWithHistoryItem(history, { expectedSession: session })).toBeUndefined()
			expect(provider.getCurrentTask()).toBe(other)
			expect(constructed.dispose).toHaveBeenCalledOnce()
			expect(constructed.resumeFromHistory).not.toHaveBeenCalled()
			expect(events).not.toHaveBeenCalled()
			expect(provider.postStateToWebview).not.toHaveBeenCalled()
		})

		it("CR-15 legacy history lifecycle never consumes a ready owner", async () => {
			setupRecovery()
			const owner = stage()
			const item = { ...history, mode: undefined, apiConfigName: undefined }
			const task = await provider.createTaskWithHistoryItem(item)
			expect(task!.handleWebviewAskResponse).not.toHaveBeenCalled()
			expect((provider as any).pendingOperations.get("task-recovery")).toBe(owner)
			provider.clearPendingEditOperation("task-recovery", owner)
		})

		it.each(["parse", "custom", "apply"])(
			"CR-10 CR-20 CR-27 import %s failure leaves chain usable",
			async (phase) => {
				setupRecovery()
				configureImport(
					phase === "custom"
						? [{ slug: "custom", name: "Custom", roleDefinition: "custom", groups: ["read"] }]
						: [],
				)
				if (phase === "parse") vi.mocked(fs.readFile).mockResolvedValue("invalid JSON")
				if (phase === "custom")
					vi.spyOn(provider.customModesManager, "updateCustomMode").mockRejectedValue(
						new Error("custom failed"),
					)
				if (phase === "apply")
					vi.mocked(provider.providerSettingsManager.import).mockRejectedValue(new Error("apply failed"))
				const epoch = (provider as any).profileSelectionEpoch
				const result = await provider.importSettingsFromPathAsUnit("settings.json")
				expect(result.success).toBe(false)
				expect((provider as any).profileSelectionEpoch).toBe(epoch + (phase === "apply" ? 1 : 0))
				await provider.activateProviderProfile({ name: "user" })
				expect(provider.contextProxy.getValue("currentApiConfigName")).toBe("user")
			},
		)

		it.each(["mode-default", "profile-list"])(
			"CR-01 CR-03 switch during read-only %s preparation",
			async (phase) => {
				const session = setupRecovery()
				const held = deferred<any>()
				const modeConfig = vi
					.spyOn(provider.providerSettingsManager, "getModeConfigId")
					.mockResolvedValue("saved-id")
				if (phase === "mode-default") modeConfig.mockReturnValueOnce(held.promise)
				else vi.mocked(provider.providerSettingsManager.listConfig).mockReturnValueOnce(held.promise)
				const recovery = provider.createTaskWithHistoryItem(
					{ ...history, apiConfigName: undefined },
					{ expectedSession: session },
				)
				await flush()
				const other = { ...session, instanceId: "same-id-new-session" }
				;(provider as any).clineStack = [other]
				held.resolve(phase === "mode-default" ? "saved-id" : [{ name: "saved-profile", id: "saved-id" }])
				expect(await recovery).toBeUndefined()
				expect(provider.getCurrentTask()).toBe(other)
				expect(provider.providerSettingsManager.activateProfile).not.toHaveBeenCalled()
				expect(provider.postStateToWebview).not.toHaveBeenCalled()
			},
		)
		it("CR-16 waits for accepted Task initialization before consuming text/images", async () => {
			const session = setupRecovery()
			const owner = stage()
			const heldReady = deferred()
			const waitModule = await import("p-wait-for")
			vi.mocked(waitModule.default).mockReturnValueOnce(heldReady.promise)
			const recovery = provider.createTaskWithHistoryItem(history, {
				expectedSession: session,
				pendingEditOwner: owner,
			})
			await flush()
			const task = provider.getCurrentTask()!
			expect(task.handleWebviewAskResponse).not.toHaveBeenCalled()
			expect((provider as any).ownedResume).toBeUndefined()
			heldReady.resolve()
			await recovery
			expect(task.handleWebviewAskResponse).toHaveBeenCalledExactlyOnceWith("messageResponse", "replacement", [
				"image",
			])
		})

		it.each(["dialog", "file", "automatic"])(
			"CR-26 CR-27 %s route enters real chain outside selection wait",
			async (route) => {
				setupRecovery()
				configureImport()
				const imports = await import("../../config/importExport")
				const options = {
					provider,
					providerSettingsManager: provider.providerSettingsManager,
					contextProxy: provider.contextProxy,
					customModesManager: provider.customModesManager,
				}
				const held = deferred()
				const unit = provider.runProfileUnit(() => held.promise)
				const epoch = (provider as any).profileSelectionEpoch
				let importing: Promise<unknown>
				if (route === "dialog") {
					const dialog = deferred<any>()
					vi.mocked(vscode.window.showOpenDialog).mockReturnValueOnce(dialog.promise)
					importing = imports.importSettings(options)
					await flush()
					expect((provider as any).profileSelectionEpoch).toBe(epoch)
					dialog.resolve([{ fsPath: "settings.json" }])
				} else if (route === "file") {
					importing = imports.importSettingsFromFile(options, { fsPath: "settings.json" } as any)
				} else {
					vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
						get: vi.fn(() => "settings.json"),
					} as any)
					const { autoImportSettings } = await import("../../../utils/autoImportSettings")
					importing = autoImportSettings(mockOutputChannel, options)
				}
				await flush()
				expect((provider as any).profileSelectionEpoch).toBe(epoch + 1)
				expect(provider.providerSettingsManager.import).not.toHaveBeenCalled()
				held.resolve()
				await Promise.all([unit, importing])
				expect(provider.contextProxy.getValue("currentApiConfigName")).toBe("imported")
			},
		)
		it("CR-05 automatic already preparing yields when owned marker arrives", async () => {
			const session = setupRecovery()
			session.abortReason = "streaming_failed"
			;(provider as any).taskCreationCallback(session)
			const aborted = session.on.mock.calls.find(([event]: [string]) => event === "taskAborted")[1]
			const heldAbort = deferred()
			session.abortTask.mockReturnValueOnce(heldAbort.promise)
			const automatic = aborted()
			await flush()
			const owner = stage()
			provider.beginOwnedResume(session, owner)
			heldAbort.resolve()
			await automatic
			expect(provider.getCurrentTask()).toBe(session)
			const task = await provider.createTaskWithHistoryItem(history, {
				expectedSession: session,
				pendingEditOwner: owner,
			})
			expect(task!.handleWebviewAskResponse).toHaveBeenCalledOnce()
		})

		it("CR-24 hung owned setup expires and permits automatic recovery without submission", async () => {
			vi.useFakeTimers()
			try {
				const session = setupRecovery()
				const owner = stage()
				provider.beginOwnedResume(session, owner)
				const heldAbort = deferred()
				session.abortTask.mockReturnValueOnce(heldAbort.promise)
				const owned = provider.createTaskWithHistoryItem(history, {
					expectedSession: session,
					pendingEditOwner: owner,
				})
				await flush()
				await vi.advanceTimersByTimeAsync(30000)
				expect((provider as any).ownedResume).toBeUndefined()
				const automatic = await provider.createTaskWithHistoryItem(history, { expectedSession: session })
				expect(automatic!.handleWebviewAskResponse).not.toHaveBeenCalled()
				heldAbort.resolve()
				expect(await owned).toBeUndefined()
			} finally {
				vi.useRealTimers()
			}
		})

		it("CR-24 hung A replaced by failed B immediately releases automatic suppression", async () => {
			const session = setupRecovery()
			const older = stage()
			provider.beginOwnedResume(session, older)
			const heldAbort = deferred()
			session.abortTask.mockReturnValueOnce(heldAbort.promise)
			const olderResume = provider.createTaskWithHistoryItem(history, {
				expectedSession: session,
				pendingEditOwner: older,
			})
			await flush()
			const newer = stage()
			provider.clearPendingEditOperation("task-recovery", newer)
			expect((provider as any).ownedResume).toBeUndefined()
			const automatic = await provider.createTaskWithHistoryItem(history, { expectedSession: session })
			expect(automatic!.handleWebviewAskResponse).not.toHaveBeenCalled()
			heldAbort.resolve()
			expect(await olderResume).toBeUndefined()
		})

		it("CR-17 superseded timer cannot delete newer owner", async () => {
			vi.useFakeTimers()
			try {
				setupRecovery()
				const older = stage()
				await vi.advanceTimersByTimeAsync(1000)
				const newer = stage()
				provider.clearPendingEditOperation("task-recovery", older)
				await vi.advanceTimersByTimeAsync(29000)
				expect((provider as any).pendingOperations.get("task-recovery")).toBe(newer)
				provider.clearPendingEditOperation("task-recovery", newer)
			} finally {
				vi.useRealTimers()
			}
		})

		it.each(["first-load", "setValues", "setConfiguration"])(
			"CR-21 CR-26 %s invalidates prepared recovery",
			async (writer) => {
				const session = setupRecovery()
				const heldAbort = deferred()
				session.abortTask.mockReturnValueOnce(heldAbort.promise)
				const recovery = provider.createTaskWithHistoryItem(history, { expectedSession: session })
				await flush()
				if (writer === "first-load") {
					await provider.contextProxy.setValue("currentApiConfigName", "saved-profile")
					vi.spyOn(provider.providerSettingsManager, "hasConfig").mockResolvedValue(true)
					await provider.synchronizeProviderProfiles()
				} else if (writer === "setValues") {
					await provider.setValues({ currentApiConfigName: "user", apiProvider: "openai" })
				} else {
					const { API } = await import("../../../extension/api")
					const api = Object.assign(Object.create(API.prototype), {
						sidebarProvider: provider,
					}) as InstanceType<typeof API>
					vi.spyOn(provider.providerSettingsManager, "saveConfig").mockResolvedValue("user-id")
					await api.setConfiguration({ currentApiConfigName: "user", apiProvider: "openai" })
				}
				heldAbort.resolve()
				await recovery
				expect(provider.providerSettingsManager.activateProfile).not.toHaveBeenCalled()
			},
		)

		it.each(["upsert", "delete", "reset", "setValues", "setConfiguration", "first-load"])(
			"CR-09 CR-21 CR-26 %s queued after commit lands last",
			async (writer) => {
				const session = setupRecovery()
				const heldWrite = deferred()
				const original = provider.contextProxy.setProviderSettings.bind(provider.contextProxy)
				vi.spyOn(provider.contextProxy, "setProviderSettings").mockImplementationOnce(async (settings) => {
					await heldWrite.promise
					await original(settings)
				})
				const recovery = provider.createTaskWithHistoryItem(history, { expectedSession: session })
				await flush()
				let later: Promise<unknown>
				if (writer === "upsert") {
					vi.spyOn(provider.providerSettingsManager, "saveConfig").mockResolvedValue("user-id")
					later = provider.upsertProviderProfile("user", { apiProvider: "openai" })
				} else if (writer === "delete") {
					await provider.contextProxy.setValue("listApiConfigMeta", [
						{ name: "saved-profile", id: "saved-id" },
						{ name: "user", id: "user" },
					])
					later = provider.deleteProviderProfile({ name: "saved-profile", id: "saved-id" })
				} else if (writer === "reset") {
					vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(t("common:answers.yes") as any)
					vi.spyOn(provider.contextProxy, "resetAllState").mockImplementation(async () => {
						await provider.contextProxy.setValue("currentApiConfigName", "reset")
					})
					vi.spyOn(provider.providerSettingsManager, "resetAllConfigs").mockResolvedValue(undefined)
					vi.spyOn(provider.customModesManager, "resetCustomModes").mockResolvedValue(undefined)
					vi.spyOn(provider, "removeClineFromStack").mockResolvedValue(undefined)
					later = provider.resetState()
				} else if (writer === "setValues") {
					later = provider.setValues({ currentApiConfigName: "user" })
				} else if (writer === "setConfiguration") {
					const { API } = await import("../../../extension/api")
					const api = Object.assign(Object.create(API.prototype), {
						sidebarProvider: provider,
					}) as InstanceType<typeof API>
					vi.spyOn(provider.providerSettingsManager, "saveConfig").mockResolvedValue("user-id")
					later = api.setConfiguration({ currentApiConfigName: "user" })
				} else {
					vi.spyOn(provider.providerSettingsManager, "hasConfig").mockResolvedValue(false)
					vi.mocked(provider.providerSettingsManager.listConfig).mockResolvedValue([
						{ name: "user", id: "user", apiProvider: "openai" },
					])
					later = provider.synchronizeProviderProfiles()
				}
				await flush()
				heldWrite.resolve()
				await Promise.all([recovery, later])
				expect(provider.contextProxy.getValue("currentApiConfigName")).toBe(
					writer === "reset" ? "reset" : "user",
				)
			},
		)
		const factoryImplementations = new Map<any, any>()
		beforeAll(async () => {
			const taskModule = await import("../../task/Task")
			const storageModule = await import("../../../utils/storage")
			const waitModule = await import("p-wait-for")
			for (const module of [fs, taskModule, storageModule, vscode.workspace, waitModule]) {
				for (const value of Object.values(module)) {
					if (vi.isMockFunction(value)) factoryImplementations.set(value, value.getMockImplementation())
				}
			}
		})
		afterEach(() => {
			vi.restoreAllMocks()
			for (const [mock, implementation] of factoryImplementations) mock.mockImplementation(implementation)
		})
		it.each(["owned-first", "automatic-first", "automatic-only"])(
			"CR-05 CR-06 CR-07 automatic recovery %s",
			async (order) => {
				const session = setupRecovery()
				session.abortReason = "streaming_failed"
				;(provider as any).taskCreationCallback(session)
				const aborted = session.on.mock.calls.find(([event]: [string]) => event === "taskAborted")[1]
				const owner = stage()
				if (order === "owned-first") {
					provider.beginOwnedResume(session, owner)
					await aborted()
					expect(provider.getTaskWithId).not.toHaveBeenCalled()
					const task = await provider.createTaskWithHistoryItem(history, {
						expectedSession: session,
						pendingEditOwner: owner,
					})
					expect(task!.handleWebviewAskResponse).toHaveBeenCalledOnce()
				} else {
					await aborted()
					const automatic = provider.getCurrentTask()!
					expect(automatic).not.toBe(session)
					expect(automatic.handleWebviewAskResponse).not.toHaveBeenCalled()
					if (order === "automatic-first") {
						expect(
							await provider.createTaskWithHistoryItem(history, {
								expectedSession: session,
								pendingEditOwner: owner,
							}),
						).toBeUndefined()
					}
					expect((provider as any).pendingOperations.get("task-recovery")).toBe(owner)
					provider.clearPendingEditOperation("task-recovery", owner)
				}
			},
		)

		it("CR-24 accepted resume releases marker before a hung submission", async () => {
			const session = setupRecovery()
			const owner = stage()
			provider.beginOwnedResume(session, owner)
			const held = deferred()
			const { Task } = await import("../../task/Task")
			vi.mocked(Task).mockImplementationOnce(
				(options: any) =>
					({
						taskId: options.historyItem.id,
						resumeFromHistory: vi.fn(),
						abortTask: vi.fn(),
						dispose: vi.fn(),
						emit: vi.fn(),
						on: vi.fn(),
						off: vi.fn(),
						handleWebviewAskResponse: vi.fn(() => held.promise),
						setTaskApiConfigName: vi.fn(),
						updateApiConfiguration: vi.fn(),
					}) as any,
			)
			const resume = provider.createTaskWithHistoryItem(history, {
				expectedSession: session,
				pendingEditOwner: owner,
			})
			await flush()
			expect((provider as any).ownedResume).toBeUndefined()
			expect((provider as any).pendingOperations.size).toBe(0)
			held.resolve()
			await resume
		})

		it.each(["before", "after"])("CR-20 real import %s guarded recovery commit", async (order) => {
			const session = setupRecovery()
			const heldAbort = deferred()
			if (order === "before") session.abortTask.mockReturnValueOnce(heldAbort.promise)
			configureImport()
			const recovery = provider.createTaskWithHistoryItem(history, { expectedSession: session })
			await flush()
			if (order === "after") await recovery
			const imported = await provider.importSettingsFromPathAsUnit("settings.json")
			expect(imported.success).toBe(true)
			if (order === "before") {
				heldAbort.resolve()
				await recovery
			}
			expect(provider.contextProxy.getValue("currentApiConfigName")).toBe("imported")
			expect(provider.contextProxy.getProviderSettings().apiProvider).toBe("openai")
			if (order === "before") expect(provider.providerSettingsManager.activateProfile).not.toHaveBeenCalled()
		})

		function configureImport(customModes: object[] = []) {
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					providerProfiles: {
						currentApiConfigName: "imported",
						apiConfigs: { imported: { id: "imported-id", apiProvider: "openai" } },
						modeApiConfigs: {},
					},
					globalSettings: { customModes },
				}),
			)
			vi.spyOn(provider.providerSettingsManager, "export").mockResolvedValue({
				currentApiConfigName: "saved-profile",
				apiConfigs: {},
				modeApiConfigs: {},
			})
			vi.spyOn(provider.providerSettingsManager, "import").mockResolvedValue(undefined)
			vi.mocked(provider.providerSettingsManager.listConfig).mockResolvedValue([
				{ name: "imported", id: "imported-id" },
			])
		}

		it.each(["global", "name", "provider", "list", "metadata"])(
			"CR-20 delayed import %s holds actual chain",
			async (phase) => {
				setupRecovery()
				configureImport()
				const held = deferred<any>()
				if (phase === "global")
					vi.spyOn(provider.contextProxy, "setValues").mockImplementationOnce(async () => {
						await held.promise
					})
				if (phase === "name" || phase === "metadata") {
					const original = provider.contextProxy.setValue.bind(provider.contextProxy)
					vi.spyOn(provider.contextProxy, "setValue").mockImplementation(async (key, value) => {
						if (key === (phase === "name" ? "currentApiConfigName" : "listApiConfigMeta"))
							await held.promise
						await original(key, value)
					})
				}
				if (phase === "provider") {
					const original = provider.contextProxy.setProviderSettings.bind(provider.contextProxy)
					vi.spyOn(provider.contextProxy, "setProviderSettings").mockImplementationOnce(async (settings) => {
						await held.promise
						await original(settings)
					})
				}
				if (phase === "list")
					vi.mocked(provider.providerSettingsManager.listConfig).mockReturnValueOnce(held.promise)
				let settled = false
				const importing = provider.importSettingsFromPathAsUnit("settings.json").then((result) => {
					settled = true
					return result
				})
				await flush()
				const later = vi.fn(async () => undefined)
				const queued = provider.runProfileUnit(later)
				await flush()
				expect(settled).toBe(false)
				expect(later).not.toHaveBeenCalled()
				held.resolve([{ name: "imported", id: "imported-id" }])
				await Promise.all([importing, queued])
				expect(provider.contextProxy.getValue("currentApiConfigName")).toBe("imported")
				expect(provider.contextProxy.getProviderSettings().apiProvider).toBe("openai")
				expect(provider.contextProxy.getValue("listApiConfigMeta")).toEqual([
					{ name: "imported", id: "imported-id" },
				])
			},
		)

		it("CR-20 CR-26 actual API setConfiguration pair is atomic", async () => {
			setupRecovery()
			const { API } = await import("../../../extension/api")
			const api = Object.assign(Object.create(API.prototype), { sidebarProvider: provider }) as InstanceType<
				typeof API
			>
			const held = deferred()
			const calls: string[] = []
			vi.spyOn(provider.contextProxy, "setValues").mockImplementationOnce(async () => {
				calls.push("values")
				await held.promise
			})
			vi.spyOn(provider.providerSettingsManager, "saveConfig").mockImplementationOnce(async () => {
				calls.push("save")
				return "id"
			})
			const configuration = api.setConfiguration({ currentApiConfigName: "api", apiProvider: "anthropic" })
			await flush()
			const later = provider.runProfileUnit(async () => {
				calls.push("later")
			})
			await flush()
			expect(calls).toEqual(["values"])
			held.resolve()
			await Promise.all([configuration, later])
			expect(calls).toEqual(["values", "save", "later"])
		})

		it("CR-27 custom mode phase cannot hold actual profile chain", async () => {
			setupRecovery()
			configureImport([{ slug: "custom", name: "Custom", roleDefinition: "custom", groups: ["read"] }])
			const heldModes = deferred()
			vi.spyOn(provider.customModesManager, "updateCustomMode").mockReturnValue(heldModes.promise)
			const importing = provider.importSettingsFromPathAsUnit("settings.json")
			await flush()
			expect(provider.customModesManager.updateCustomMode).toHaveBeenCalledOnce()
			expect(provider.providerSettingsManager.import).not.toHaveBeenCalled()
			await provider.activateProviderProfile({ name: "user" })
			expect(provider.contextProxy.getValue("currentApiConfigName")).toBe("user")
			heldModes.resolve()
			await importing
			expect(provider.providerSettingsManager.import).toHaveBeenCalledOnce()
		})

		it.each(["upsert", "delete", "reset", "createTask"])(
			"CR-21 CR-26 %s writer invalidates prepared recovery",
			async (writer) => {
				const session = setupRecovery()
				const held = deferred()
				session.abortTask.mockReturnValueOnce(held.promise)
				const recovery = provider.createTaskWithHistoryItem(history, { expectedSession: session })
				await flush()
				const epoch = (provider as any).profileSelectionEpoch
				if (writer === "upsert") {
					vi.spyOn(provider.providerSettingsManager, "saveConfig").mockResolvedValue("user-id")
					await provider.upsertProviderProfile("user", { apiProvider: "openai" })
				} else if (writer === "delete") {
					await provider.contextProxy.setValues({
						currentApiConfigName: "user",
						listApiConfigMeta: [
							{ name: "user", id: "user" },
							{ name: "saved-profile", id: "saved-id" },
						],
					})
					await provider.deleteProviderProfile({ name: "user", id: "user" })
				} else if (writer === "reset") {
					vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(t("common:answers.yes") as any)
					vi.spyOn(provider.contextProxy, "resetAllState").mockResolvedValue(undefined)
					vi.spyOn(provider.providerSettingsManager, "resetAllConfigs").mockResolvedValue(undefined)
					vi.spyOn(provider.customModesManager, "resetCustomModes").mockResolvedValue(undefined)
					vi.spyOn(provider, "removeClineFromStack").mockResolvedValue(undefined)
					await provider.resetState()
				} else {
					vi.spyOn(provider, "addClineToStack").mockResolvedValue(undefined)
					const { Task } = await import("../../task/Task")
					vi.mocked(Task).mockImplementationOnce(() => ({ start: vi.fn() }) as any)
					await provider.createTask("new", undefined, session, {}, { apiProvider: "openai" })
				}
				expect((provider as any).profileSelectionEpoch).toBeGreaterThan(epoch)
				held.resolve()
				await recovery
				expect(provider.providerSettingsManager.activateProfile).not.toHaveBeenCalled()
			},
		)
		function deferred<Value = void>() {
			let resolve!: (value: Value) => void
			let reject!: (error: Error) => void
			const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
				resolve = resolvePromise
				reject = rejectPromise
			})
			return { promise, resolve, reject }
		}

		async function flush() {
			for (let iteration = 0; iteration < 20; iteration++) await Promise.resolve()
		}

		const history: HistoryItem = {
			id: "recovery",
			number: 1,
			ts: 1,
			task: "saved",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			mode: "code",
			apiConfigName: "saved-profile",
		}

		function setupRecovery() {
			const session = {
				taskId: history.id,
				instanceId: "old",
				abortTask: vi.fn().mockResolvedValue(undefined),
				cancelCurrentRequest: vi.fn(),
				isStreaming: false,
				emit: vi.fn(),
				setTaskApiConfigName: vi.fn(),
				updateApiConfiguration: vi.fn(),
				on: vi.fn(),
				off: vi.fn(),
			} as any
			;(provider as any).clineStack = [session]
			vi.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: { apiProvider: "anthropic" },
				mode: "code",
				organizationAllowList: ORGANIZATION_ALLOW_ALL,
			} as any)
			vi.spyOn(provider, "postStateToWebview").mockResolvedValue(undefined)
			vi.spyOn(provider, "performPreparationTasks").mockResolvedValue(undefined)
			vi.spyOn(provider.customModesManager, "getCustomModes").mockResolvedValue([])
			vi.spyOn(provider.providerSettingsManager, "getProfile").mockResolvedValue({
				name: "saved-profile",
				id: "saved-id",
				apiProvider: "anthropic",
			})
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockImplementation(async (args) => ({
				name: "name" in args ? args.name : "saved-profile",
				id: "saved-id",
				apiProvider: "anthropic",
			}))
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "saved-profile", id: "saved-id" },
			])
			vi.spyOn(provider.providerSettingsManager, "setModeConfig").mockResolvedValue(undefined)
			vi.spyOn(provider, "getTaskWithId").mockResolvedValue({ historyItem: history } as any)
			vi.spyOn(provider as any, "getTaskHistoryItem").mockReturnValue(undefined)
			return session
		}

		function stage(text = "replacement") {
			const owner = provider.setPendingEditOperation("task-recovery", {
				messageTs: 1,
				messageIndex: 0,
				apiConversationHistoryIndex: 0,
				editedContent: text,
				images: ["image"],
			})
			provider.markPendingEditReady("task-recovery", owner)
			return owner
		}

		it.each(["history", "modes", "profile", "state", "abort"])(
			"CR-01 CR-02 CR-03 CR-04 rejects same-id replacement during %s",
			async (phase) => {
				const session = setupRecovery()
				const owner = stage()
				const held = deferred<any>()
				if (phase === "history") vi.mocked(provider.getTaskWithId).mockReturnValueOnce(held.promise)
				if (phase === "modes")
					vi.mocked(provider.customModesManager.getCustomModes).mockReturnValueOnce(held.promise)
				if (phase === "profile")
					vi.mocked(provider.providerSettingsManager.getProfile).mockReturnValueOnce(held.promise)
				if (phase === "state") vi.mocked(provider.getState).mockReturnValueOnce(held.promise)
				if (phase === "abort") session.abortTask.mockReturnValueOnce(held.promise)
				const events = vi.spyOn(provider, "emit")
				const resume =
					phase === "history"
						? provider.restartTaskIfCurrent(session)
						: provider.createTaskWithHistoryItem(history, {
								expectedSession: session,
								pendingEditOwner: owner,
							})
				await flush()
				const replacementSession = { ...session, instanceId: "new" }
				;(provider as any).clineStack = [replacementSession]
				held.resolve(
					phase === "history"
						? { historyItem: history }
						: phase === "modes"
							? []
							: phase === "profile"
								? { apiProvider: "anthropic" }
								: { apiConfiguration: {} },
				)
				expect(await resume).toBeFalsy()
				expect(provider.getCurrentTask()).toBe(replacementSession)
				expect(events).not.toHaveBeenCalled()
				expect(provider.postStateToWebview).not.toHaveBeenCalled()
				expect(provider.providerSettingsManager.activateProfile).not.toHaveBeenCalled()
				expect((provider as any).pendingOperations.get("task-recovery")).toBe(owner)
				if (phase === "abort") {
					const { Task } = await import("../../task/Task")
					const constructed = vi.mocked(Task).mock.results.at(-1)!.value
					expect(constructed.dispose).toHaveBeenCalledOnce()
					expect(constructed.resumeFromHistory).not.toHaveBeenCalled()
				}
				provider.clearPendingEditOperation("task-recovery", owner)
			},
		)

		it("CR-15 ownerless accepted recovery never consumes ready edit", async () => {
			const session = setupRecovery()
			const owner = stage()
			const task = await provider.createTaskWithHistoryItem(history, { expectedSession: session })
			expect(task!.resumeFromHistory).toHaveBeenCalledOnce()
			expect(task!.handleWebviewAskResponse).not.toHaveBeenCalled()
			expect((provider as any).pendingOperations.get("task-recovery")).toBe(owner)
			provider.clearPendingEditOperation("task-recovery", owner)
		})

		it.each(["older-first", "newer-first"])("CR-16 CR-17 overlapping owners %s", async (order) => {
			const session = setupRecovery()
			const older = stage("older")
			const olderAbort = deferred()
			session.abortTask.mockReturnValueOnce(olderAbort.promise)
			const olderResume = provider.createTaskWithHistoryItem(history, {
				expectedSession: session,
				pendingEditOwner: older,
			})
			await flush()
			const newer = stage("newer")
			expect(provider.clearPendingEditOperation("task-recovery", older)).toBe(false)
			if (order === "older-first") {
				olderAbort.resolve()
				await olderResume
				const active = provider.getCurrentTask()!
				const task = await provider.createTaskWithHistoryItem(history, {
					expectedSession: active,
					pendingEditOwner: newer,
				})
				expect(task!.handleWebviewAskResponse).toHaveBeenCalledExactlyOnceWith("messageResponse", "newer", [
					"image",
				])
			} else {
				const task = await provider.createTaskWithHistoryItem(history, {
					expectedSession: session,
					pendingEditOwner: newer,
				})
				olderAbort.resolve()
				expect(await olderResume).toBeUndefined()
				expect(task!.handleWebviewAskResponse).toHaveBeenCalledExactlyOnceWith("messageResponse", "newer", [
					"image",
				])
			}
			expect((provider as any).pendingOperations.size).toBe(0)
		})

		it("CR-23 stop-only cancellation preserves identity and rejects superseded session", async () => {
			const session = setupRecovery()
			await provider.cancelTask({ expectedSession: session, rehydrate: false })
			expect(provider.getCurrentTask()).toBe(session)
			expect(session.cancelCurrentRequest).toHaveBeenCalledOnce()
			const nextSession = { ...session, cancelCurrentRequest: vi.fn() }
			;(provider as any).clineStack = [nextSession]
			await provider.cancelTask({ expectedSession: session })
			expect(nextSession.cancelCurrentRequest).not.toHaveBeenCalled()
		})

		it("restarts a stop-only cancelled session without consuming a pending edit", async () => {
			const session = setupRecovery()
			const owner = stage()
			await provider.cancelTask({ expectedSession: session, rehydrate: false })
			expect(session.abandoned).toBe(true)
			expect(await provider.restartTaskIfCurrent(session)).toBe(true)
			const replacement = provider.getCurrentTask()!
			expect(replacement).not.toBe(session)
			expect(replacement.resumeFromHistory).toHaveBeenCalledOnce()
			expect(replacement.handleWebviewAskResponse).not.toHaveBeenCalled()
			expect((provider as any).pendingOperations.get("task-recovery")).toBe(owner)
			provider.clearPendingEditOperation("task-recovery", owner)
		})

		it("CR-23 superseded restore settles after navigation to another task without cancellation or pending consumption", async () => {
			const session = setupRecovery()
			const checkpointHash = "a".repeat(40)
			const heldRestore = deferred()
			const restoreCheckpoint = vi.fn(() => heldRestore.promise)
			Object.assign(session, {
				enableCheckpoints: true,
				checkpointService: { restoreCheckpoint },
				providerRef: new WeakRef(provider),
				clineMessages: [{ ts: 1, type: "say", say: "checkpoint_saved", text: checkpointHash }],
				combineMessages: vi.fn(() => []),
				messageManager: { rewindToTimestamp: vi.fn().mockResolvedValue(undefined) },
				recordCheckpointDeletedUsage: vi.fn().mockResolvedValue(undefined),
				handleWebviewAskResponse: vi.fn(),
			})
			const olderOwner = provider.setPendingEditOperation("task-recovery", {
				messageTs: 1,
				messageIndex: 0,
				apiConversationHistoryIndex: 0,
				editedContent: "older",
				images: ["older-image"],
			})
			const markReady = vi.spyOn(provider, "markPendingEditReady")
			const beginOwnedResume = vi.spyOn(provider, "beginOwnedResume")
			const cancelTask = vi.spyOn(provider, "cancelTask")
			const createTask = vi.spyOn(provider, "createTaskWithHistoryItem")
			const { checkpointRestore } = await import("../../checkpoints")
			const restoring = checkpointRestore(session, {
				ts: 1,
				commitHash: checkpointHash,
				mode: "restore",
				operation: "edit",
				pendingEditOwner: olderOwner,
			})
			await vi.waitFor(() => expect(restoreCheckpoint).toHaveBeenCalledExactlyOnceWith(checkpointHash))
			const newerOwner = stage("newer")
			const otherTask = {
				...session,
				taskId: "other-task",
				instanceId: "other-session",
				cancelCurrentRequest: vi.fn(),
				abortTask: vi.fn(),
				handleWebviewAskResponse: vi.fn(),
			}
			;(provider as any).clineStack = [otherTask]
			expect(cancelTask).not.toHaveBeenCalled()
			heldRestore.resolve()
			await restoring
			await cancelTask.mock.results[0].value
			expect(markReady).toHaveBeenLastCalledWith("task-recovery", olderOwner)
			expect(markReady.mock.results.at(-1)!.value).toBe(false)
			expect(olderOwner.ready).toBe(false)
			expect(cancelTask).toHaveBeenCalledExactlyOnceWith({ expectedSession: session })
			expect(beginOwnedResume).not.toHaveBeenCalled()
			expect(createTask).not.toHaveBeenCalled()
			expect(session.cancelCurrentRequest).not.toHaveBeenCalled()
			expect(session.abortTask).not.toHaveBeenCalled()
			expect(otherTask.cancelCurrentRequest).not.toHaveBeenCalled()
			expect(otherTask.abortTask).not.toHaveBeenCalled()
			expect(session.handleWebviewAskResponse).not.toHaveBeenCalled()
			expect(otherTask.handleWebviewAskResponse).not.toHaveBeenCalled()
			expect(provider.getCurrentTask()).toBe(otherTask)
			expect((provider as any).pendingOperations.get("task-recovery")).toBe(newerOwner)
			expect(newerOwner.ready).toBe(true)
			provider.clearPendingEditOperation("task-recovery", newerOwner)
		})

		it("CR-24 retirement releases only matching marker without submission", async () => {
			vi.useFakeTimers()
			try {
				const session = setupRecovery()
				const older = stage("older")
				provider.beginOwnedResume(session, older)
				const newer = stage("newer")
				expect((provider as any).ownedResume).toBeUndefined()
				provider.beginOwnedResume(session, newer)
				;(provider as any).releaseOwnedResume(older)
				expect((provider as any).ownedResume.attempt).toBe(newer)
				await vi.advanceTimersByTimeAsync(30000)
				expect((provider as any).ownedResume).toBeUndefined()
				expect((provider as any).pendingOperations.size).toBe(0)
			} finally {
				vi.useRealTimers()
			}
		})

		it.each(["before", "after"])("CR-08 CR-09 CR-11 user selection %s recovery commit", async (order) => {
			const session = setupRecovery()
			const heldAbort = deferred()
			if (order === "before") session.abortTask.mockReturnValueOnce(heldAbort.promise)
			const resume = provider.createTaskWithHistoryItem(history, { expectedSession: session })
			await flush()
			if (order === "after") await resume
			await provider.activateProviderProfile({ name: "user-profile" })
			if (order === "before") {
				heldAbort.resolve()
				await resume
			}
			expect(provider.contextProxy.getValue("currentApiConfigName")).toBe("user-profile")
			expect(provider.providerSettingsManager.setModeConfig).toHaveBeenCalledTimes(1)
			const calls = vi.mocked(provider.providerSettingsManager.activateProfile).mock.calls
			expect(calls.at(-1)).toEqual([{ name: "user-profile" }])
			if (order === "before") expect(calls).toHaveLength(1)
		})

		it("CR-10 CR-12 rejected unit does not block later selection or wait on notifications", async () => {
			setupRecovery()
			const notification = deferred<boolean>()
			vi.mocked(provider.postStateToWebview).mockReturnValueOnce(notification.promise as any)
			vi.mocked(provider.providerSettingsManager.activateProfile).mockRejectedValueOnce(new Error("failed"))
			await expect(provider.activateProviderProfile({ name: "bad" })).rejects.toThrow("failed")
			const first = provider.activateProviderProfile({ name: "first" })
			await flush()
			await provider.activateProviderProfile({ name: "last" })
			expect(provider.contextProxy.getValue("currentApiConfigName")).toBe("last")
			notification.resolve(true)
			await first
		})

		it("CR-22 task switch during profile writes changes neither task handler nor sticky", async () => {
			const session = setupRecovery()
			const heldWrite = deferred()
			vi.spyOn(provider.contextProxy, "setProviderSettings").mockReturnValueOnce(heldWrite.promise)
			const resume = provider.createTaskWithHistoryItem(history, { expectedSession: session })
			await flush()
			const accepted = provider.getCurrentTask()!
			const other = {
				...session,
				taskId: "other",
				setTaskApiConfigName: vi.fn(),
				updateApiConfiguration: vi.fn(),
			}
			;(provider as any).clineStack = [other]
			heldWrite.resolve()
			await resume
			expect(accepted.updateApiConfiguration).not.toHaveBeenCalled()
			expect(accepted.setTaskApiConfigName).not.toHaveBeenCalled()
			expect(other.updateApiConfiguration).not.toHaveBeenCalled()
			expect(other.setTaskApiConfigName).not.toHaveBeenCalled()
		})

		it("CR-21 CR-26 first-load uses one inner unit and bumps epoch", async () => {
			setupRecovery()
			await provider.contextProxy.setValue("currentApiConfigName", "invalid")
			vi.spyOn(provider.providerSettingsManager, "hasConfig").mockResolvedValue(false)
			const epoch = (provider as any).profileSelectionEpoch
			await provider.synchronizeProviderProfiles()
			expect((provider as any).profileSelectionEpoch).toBe(epoch + 1)
			expect(provider.contextProxy.getValue("currentApiConfigName")).toBe("saved-profile")
			expect(provider.providerSettingsManager.activateProfile).toHaveBeenCalledOnce()
		})

		it("CR-26 mode-only setValues bypasses held chain; all provider keys queue", async () => {
			setupRecovery()
			const held = deferred()
			const first = provider.runProfileUnit(() => held.promise)
			const epoch = (provider as any).profileSelectionEpoch
			await provider.setValues({ mode: "architect" })
			expect((provider as any).profileSelectionEpoch).toBe(epoch)
			const setting = provider.setValues({ apiProvider: "anthropic" })
			expect((provider as any).profileSelectionEpoch).toBe(epoch + 1)
			held.resolve()
			await Promise.all([first, setting])
		})
	})

	describe("activateProviderProfile", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		it("should save provider profile to task metadata when switching profiles", async () => {
			// Create a mock task
			const mockTask = {
				taskId: "test-task-id",
				_taskApiConfigName: "default-profile",
				setTaskApiConfigName: vi.fn(),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
			}

			// Add task to provider stack
			await provider.addClineToStack(mockTask as any)

			// Populate the store so persistStickyProviderProfileToCurrentTask finds the task
			await provider.taskHistoryStore.upsert({
				id: mockTask.taskId,
				ts: Date.now(),
				task: "Test task",
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			})

			// Mock updateTaskHistory to track calls
			const updateTaskHistorySpy = vi
				.spyOn(provider, "updateTaskHistory")
				.mockImplementation(() => Promise.resolve([]))

			// Mock providerSettingsManager.activateProfile
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "new-profile",
				id: "new-profile-id",
				apiProvider: "anthropic",
			})

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "new-profile", id: "new-profile-id", apiProvider: "anthropic" },
			])

			// Switch provider profile
			await provider.activateProviderProfile({ name: "new-profile" })

			// Verify task history was updated with new provider profile
			expect(updateTaskHistorySpy).toHaveBeenCalledWith(
				expect.objectContaining({
					id: mockTask.taskId,
					apiConfigName: "new-profile",
				}),
				{ broadcast: false },
			)

			// Verify task's setTaskApiConfigName was called
			expect(mockTask.setTaskApiConfigName).toHaveBeenCalledWith("new-profile")
		})

		it("should update task's taskApiConfigName property when switching profiles", async () => {
			// Create a mock task with initial profile
			const mockTask = {
				taskId: "test-task-id",
				_taskApiConfigName: "default-profile",
				setTaskApiConfigName: vi.fn().mockImplementation(function (this: any, name: string) {
					this._taskApiConfigName = name
				}),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
			}

			// Add task to provider stack
			await provider.addClineToStack(mockTask as any)

			// Mock getGlobalState to return task history
			vi.spyOn(provider as any, "getGlobalState").mockReturnValue([
				{
					id: mockTask.taskId,
					ts: Date.now(),
					task: "Test task",
					number: 1,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					totalCost: 0,
				},
			])

			// Mock updateTaskHistory
			vi.spyOn(provider, "updateTaskHistory").mockImplementation(() => Promise.resolve([]))

			// Mock providerSettingsManager.activateProfile
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "new-profile",
				id: "new-profile-id",
				apiProvider: "openrouter",
			})

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "new-profile", id: "new-profile-id", apiProvider: "openrouter" },
			])

			// Switch provider profile
			await provider.activateProviderProfile({ name: "new-profile" })

			// Verify task's _taskApiConfigName property was updated
			expect(mockTask._taskApiConfigName).toBe("new-profile")
		})

		it("should update in-memory task profile even if task history item does not exist yet", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			const mockTask = {
				taskId: "test-task-id",
				_taskApiConfigName: "default-profile",
				setTaskApiConfigName: vi.fn().mockImplementation(function (this: any, name: string) {
					this._taskApiConfigName = name
				}),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
			}

			await provider.addClineToStack(mockTask as any)

			// No history item exists yet
			vi.spyOn(provider as any, "getGlobalState").mockReturnValue([])

			const updateTaskHistorySpy = vi
				.spyOn(provider, "updateTaskHistory")
				.mockImplementation(() => Promise.resolve([]))

			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "new-profile",
				id: "new-profile-id",
				apiProvider: "openrouter",
			})

			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "new-profile", id: "new-profile-id", apiProvider: "openrouter" },
			])

			await provider.activateProviderProfile({ name: "new-profile" })

			// In-memory should still update, even without a history item.
			expect(mockTask._taskApiConfigName).toBe("new-profile")
			// No history item => no updateTaskHistory call.
			expect(updateTaskHistorySpy).not.toHaveBeenCalled()
		})
	})

	describe("createTaskWithHistoryItem", () => {
		it("should restore provider profile from history item when reopening task outside CLI runtime", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item with saved provider profile
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				mode: "code",
				apiConfigName: "saved-profile", // Saved provider profile
			}

			// Mock activateProviderProfile to track calls
			const activateProviderProfileSpy = vi
				.spyOn(provider, "activateProviderProfile")
				.mockResolvedValue(undefined)

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "saved-profile", id: "saved-profile-id", apiProvider: "anthropic" },
			])

			// Initialize task with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify provider profile was restored via activateProviderProfile (restore-only: don't persist mode config)
			expect(activateProviderProfileSpy).toHaveBeenCalledWith(
				{ name: "saved-profile" },
				{ persistModeConfig: false, persistTaskHistory: false },
			)
		})

		it("should skip restoring task apiConfigName from history in CLI runtime", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			process.env.ROO_CLI_RUNTIME = "1"

			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				apiConfigName: "saved-profile",
			}

			const activateProviderProfileSpy = vi
				.spyOn(provider, "activateProviderProfile")
				.mockResolvedValue(undefined)
			const logSpy = vi.spyOn(provider, "log")

			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "saved-profile", id: "saved-profile-id", apiProvider: "anthropic" },
			])

			await provider.createTaskWithHistoryItem(historyItem)

			expect(activateProviderProfileSpy).not.toHaveBeenCalledWith({ name: "saved-profile" }, expect.anything())
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Skipping restore of provider profile 'saved-profile'"),
			)
		})

		it("should skip restoring mode-based provider config from history in CLI runtime", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			process.env.ROO_CLI_RUNTIME = "1"

			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				mode: "code",
			}

			const activateProviderProfileSpy = vi
				.spyOn(provider, "activateProviderProfile")
				.mockResolvedValue(undefined)

			vi.spyOn(provider.providerSettingsManager, "getModeConfigId").mockResolvedValue("mode-config-id")
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "mode-profile", id: "mode-config-id", apiProvider: "anthropic" },
			])

			await provider.createTaskWithHistoryItem(historyItem)

			expect(activateProviderProfileSpy).not.toHaveBeenCalled()
		})

		it("should use current profile if history item has no saved apiConfigName", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item without saved provider profile
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				// No apiConfigName field
			}

			// Mock activateProviderProfile to track calls
			const activateProviderProfileSpy = vi
				.spyOn(provider, "activateProviderProfile")
				.mockResolvedValue(undefined)

			// Initialize task with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify activateProviderProfile was NOT called for apiConfigName restoration
			// (it might be called for mode-based config, but not for direct apiConfigName)
			const callsForApiConfigName = activateProviderProfileSpy.mock.calls.filter(
				(call) => call[0] && "name" in call[0] && call[0].name === historyItem.apiConfigName,
			)
			expect(callsForApiConfigName.length).toBe(0)
		})

		it("should override mode-based config with task's apiConfigName", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item with both mode and apiConfigName
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				mode: "architect", // Mode has a different preferred profile
				apiConfigName: "task-specific-profile", // Task's actual profile
			}

			// Track all activateProviderProfile calls
			const activateCalls: string[] = []
			vi.spyOn(provider, "activateProviderProfile").mockImplementation(async (args) => {
				if ("name" in args) {
					activateCalls.push(args.name)
				}
			})

			// Mock providerSettingsManager methods
			vi.spyOn(provider.providerSettingsManager, "getModeConfigId").mockResolvedValue("mode-config-id")
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "mode-preferred-profile", id: "mode-config-id", apiProvider: "anthropic" },
				{ name: "task-specific-profile", id: "task-profile-id", apiProvider: "openai" },
			])

			// Initialize task with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify task's apiConfigName was activated LAST (overriding mode-based config)
			expect(activateCalls[activateCalls.length - 1]).toBe("task-specific-profile")
		})

		it("should handle missing provider profile gracefully", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item with a provider profile that no longer exists
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				apiConfigName: "deleted-profile", // Profile that doesn't exist
			}

			// Mock providerSettingsManager.listConfig to return empty (profile doesn't exist)
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([])

			// Mock log to verify warning is logged
			const logSpy = vi.spyOn(provider, "log")

			// Initialize task with history item - should not throw
			await expect(provider.createTaskWithHistoryItem(historyItem)).resolves.not.toThrow()

			// Verify a warning was logged
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Provider profile 'deleted-profile' from history no longer exists"),
			)
		})
	})

	describe("Task metadata persistence", () => {
		it("should include apiConfigName in task metadata when saving", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a mock task with provider profile
			const mockTask = {
				taskId: "test-task-id",
				_taskApiConfigName: "test-profile",
				setTaskApiConfigName: vi.fn(),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
			}

			// Populate the store so persistStickyProviderProfileToCurrentTask finds the task
			await provider.taskHistoryStore.upsert({
				id: mockTask.taskId,
				ts: Date.now(),
				task: "Test task",
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			})

			// Mock updateTaskHistory to capture the updated history item
			let updatedHistoryItem: any
			vi.spyOn(provider, "updateTaskHistory").mockImplementation((item) => {
				updatedHistoryItem = item
				return Promise.resolve([item])
			})

			// Add task to provider stack
			await provider.addClineToStack(mockTask as any)

			// Mock providerSettingsManager.activateProfile
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "new-profile",
				id: "new-profile-id",
				apiProvider: "anthropic",
			})

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "new-profile", id: "new-profile-id", apiProvider: "anthropic" },
			])

			// Trigger a profile switch
			await provider.activateProviderProfile({ name: "new-profile" })

			// Verify apiConfigName was included in the updated history item
			expect(updatedHistoryItem).toBeDefined()
			expect(updatedHistoryItem.apiConfigName).toBe("new-profile")
		})
	})

	describe("Multiple workspaces isolation", () => {
		it("should preserve task profile when switching profiles in another workspace", async () => {
			// This test verifies that each task retains its designated provider profile
			// so that switching profiles in one workspace doesn't alter other tasks

			await provider.resolveWebviewView(mockWebviewView)

			// Create task 1 with profile A
			const task1 = {
				taskId: "task-1",
				_taskApiConfigName: "profile-a",
				setTaskApiConfigName: vi.fn().mockImplementation(function (this: any, name: string) {
					this._taskApiConfigName = name
				}),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
			}

			// Create task 2 with profile B
			const task2 = {
				taskId: "task-2",
				_taskApiConfigName: "profile-b",
				setTaskApiConfigName: vi.fn().mockImplementation(function (this: any, name: string) {
					this._taskApiConfigName = name
				}),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
			}

			// Add task 1 to stack
			await provider.addClineToStack(task1 as any)

			// Mock getGlobalState to return task history for both tasks
			const taskHistory = [
				{
					id: "task-1",
					ts: Date.now(),
					task: "Task 1",
					number: 1,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					totalCost: 0,
					apiConfigName: "profile-a",
				},
				{
					id: "task-2",
					ts: Date.now(),
					task: "Task 2",
					number: 2,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					totalCost: 0,
					apiConfigName: "profile-b",
				},
			]

			// Populate the store
			for (const item of taskHistory) {
				await provider.taskHistoryStore.upsert(item as any)
			}

			// Mock updateTaskHistory
			vi.spyOn(provider, "updateTaskHistory").mockImplementation((item) => {
				const index = taskHistory.findIndex((h) => h.id === item.id)
				if (index >= 0) {
					taskHistory[index] = { ...taskHistory[index], ...item }
				}
				return Promise.resolve(taskHistory)
			})

			// Mock providerSettingsManager.activateProfile
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "profile-c",
				id: "profile-c-id",
				apiProvider: "anthropic",
			})

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "profile-a", id: "profile-a-id", apiProvider: "anthropic" },
				{ name: "profile-b", id: "profile-b-id", apiProvider: "openai" },
				{ name: "profile-c", id: "profile-c-id", apiProvider: "anthropic" },
			])

			// Switch task 1's profile to profile C
			await provider.activateProviderProfile({ name: "profile-c" })

			// Verify task 1's profile was updated
			expect(task1._taskApiConfigName).toBe("profile-c")
			expect(taskHistory[0].apiConfigName).toBe("profile-c")

			// Verify task 2's profile remains unchanged
			expect(taskHistory[1].apiConfigName).toBe("profile-b")
		})
	})

	describe("Error handling", () => {
		it("should handle errors gracefully when saving profile fails", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a mock task
			const mockTask = {
				taskId: "test-task-id",
				_taskApiConfigName: "default-profile",
				setTaskApiConfigName: vi.fn(),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
			}

			// Add task to provider stack
			await provider.addClineToStack(mockTask as any)

			// Populate the store
			await provider.taskHistoryStore.upsert({
				id: mockTask.taskId,
				ts: Date.now(),
				task: "Test task",
				number: 1,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			})

			// Mock updateTaskHistory to throw error
			vi.spyOn(provider, "updateTaskHistory").mockRejectedValue(new Error("Save failed"))

			// Mock providerSettingsManager.activateProfile
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "new-profile",
				id: "new-profile-id",
				apiProvider: "anthropic",
			})

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "new-profile", id: "new-profile-id", apiProvider: "anthropic" },
			])

			// Mock log to verify error is logged
			const logSpy = vi.spyOn(provider, "log")

			// Switch provider profile - should not throw
			await expect(provider.activateProviderProfile({ name: "new-profile" })).resolves.not.toThrow()

			// Verify error was logged
			expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to persist provider profile switch"))
		})

		it("should handle null/undefined apiConfigName gracefully", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item with null apiConfigName
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				apiConfigName: null as any, // Invalid apiConfigName
			}

			// Mock activateProviderProfile to track calls
			const activateProviderProfileSpy = vi
				.spyOn(provider, "activateProviderProfile")
				.mockResolvedValue(undefined)

			// Initialize task with history item - should not throw
			await expect(provider.createTaskWithHistoryItem(historyItem)).resolves.not.toThrow()

			// Verify activateProviderProfile was not called with null
			expect(activateProviderProfileSpy).not.toHaveBeenCalledWith({ name: null })
		})
	})

	describe("Profile restoration with activateProfile failure", () => {
		it("should continue task restoration even if activateProviderProfile fails", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item with saved provider profile
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				apiConfigName: "failing-profile",
			}

			// Mock providerSettingsManager.listConfig to return the profile
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "failing-profile", id: "failing-profile-id", apiProvider: "anthropic" },
			])

			// Mock activateProviderProfile to throw error
			vi.spyOn(provider, "activateProviderProfile").mockRejectedValue(new Error("Activation failed"))

			// Mock log to verify error is logged
			const logSpy = vi.spyOn(provider, "log")

			// Initialize task with history item - should not throw even though activation fails
			await expect(provider.createTaskWithHistoryItem(historyItem)).resolves.not.toThrow()

			// Verify error was logged
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failed to restore API configuration 'failing-profile' for task"),
			)
		})
	})
})
