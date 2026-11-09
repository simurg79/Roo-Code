// npx vitest run core/task/__tests__/Task.instruction-refresh.e2e.spec.ts

import * as os from "os"
import * as path from "path"

import type * as vscode from "vscode"

import type { ProviderSettings } from "@roo-code/types"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import type { ApiHandler } from "../../../api"
import * as contextManagement from "../../context-management"
import * as buildTools from "../build-tools"

// In-memory files keyed by absolute path; directories are derived from file paths.
const { virtualFiles, missing } = vi.hoisted(() => ({
	virtualFiles: new Map<string, string>(),
	missing: () => Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>
	const isVirtualDirectory = (directoryPath: string) => {
		const prefix = path.resolve(directoryPath) + path.sep
		return [...virtualFiles.keys()].some((filePath) => filePath.startsWith(prefix))
	}
	const statOf = (isFile: boolean) => ({ isFile: () => isFile, isDirectory: () => !isFile })
	const mockFunctions = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
		readlink: vi.fn().mockImplementation(async () => {
			throw missing()
		}),
		lstat: vi.fn().mockImplementation(async () => {
			throw missing()
		}),
		stat: vi.fn().mockImplementation(async (target: string) => {
			const resolved = path.resolve(target)
			if (virtualFiles.has(resolved)) return statOf(true)
			if (isVirtualDirectory(resolved)) return statOf(false)
			throw missing()
		}),
		readdir: vi.fn().mockImplementation(async (directoryPath: string) => {
			const prefix = path.resolve(directoryPath) + path.sep
			return [...virtualFiles.keys()]
				.filter((filePath) => filePath.startsWith(prefix))
				.map((filePath) => ({
					name: path.basename(filePath),
					parentPath: path.dirname(filePath),
					isFile: () => true,
					isSymbolicLink: () => false,
				}))
		}),
		readFile: vi.fn().mockImplementation(async (target: string) => {
			const content = virtualFiles.get(path.resolve(target))
			if (content === undefined) throw missing()
			return content
		}),
	}
	return { ...actual, ...mockFunctions, default: mockFunctions }
})

vi.mock("p-wait-for", () => ({ default: vi.fn().mockResolvedValue(undefined) }))
vi.mock("delay", () => ({ __esModule: true, default: vi.fn().mockResolvedValue(undefined) }))
vi.mock("execa", () => ({ execa: vi.fn() }))

vi.mock("vscode", () => {
	const disposable = { dispose: vi.fn() }
	return {
		window: {
			createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			visibleTextEditors: [],
			tabGroups: { all: [], close: vi.fn(), onDidChangeTabs: vi.fn(() => disposable) },
			showErrorMessage: vi.fn(),
			activeTextEditor: undefined,
		},
		workspace: {
			workspaceFolders: [{ uri: { fsPath: "/mock/workspace/path" }, name: "mock-workspace", index: 0 }],
			getWorkspaceFolder: vi.fn(),
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => disposable),
				onDidDelete: vi.fn(() => disposable),
				onDidChange: vi.fn(() => disposable),
				dispose: vi.fn(),
			})),
			fs: { stat: vi.fn().mockResolvedValue({ type: 1 }) },
			onDidSaveTextDocument: vi.fn(() => disposable),
			onDidChangeConfiguration: vi.fn(() => disposable),
			getConfiguration: vi.fn(() => ({ get: (_key: string, defaultValue: unknown) => defaultValue })),
		},
		env: { uriScheme: "vscode", language: "en" },
		EventEmitter: vi.fn().mockImplementation(() => ({ event: vi.fn(), fire: vi.fn() })),
		Disposable: { from: vi.fn() },
		TabInputText: vi.fn(),
		TabInputTextDiff: vi.fn(),
		CodeActionKind: { QuickFix: { value: "quickfix" }, RefactorRewrite: { value: "refactor.rewrite" } },
	}
})

vi.mock("../../environment/getEnvironmentDetails", () => ({ getEnvironmentDetails: vi.fn().mockResolvedValue("") }))
vi.mock("../../ignore/RooIgnoreController")
vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi.fn(async (root: string, taskId: string) => `${root}/tasks/${taskId}`),
	getSettingsDirectoryPath: vi.fn(async (root: string) => `${root}/settings`),
}))
// Keep rule discovery inside the workspace so the developer's real ~/.roo cannot leak in.
vi.mock("../../../services/roo-config", async (importOriginal) => ({
	...((await importOriginal()) as object),
	getRooDirectoriesForCwd: (cwd: string) => [path.join(cwd, ".roo")],
	getAllRooDirectoriesForCwd: async (cwd: string) => [path.join(cwd, ".roo")],
	getAgentsDirectoriesForCwd: async (cwd: string) => [cwd],
}))
vi.mock("../../condense", async (importOriginal) => ({
	...((await importOriginal()) as object),
	summarizeConversation: vi.fn().mockResolvedValue({
		messages: [{ role: "user", content: "condensed continuation" }],
		summary: "summary still quoting STALE CODE RULE",
		cost: 0,
		newContextTokens: 1,
	}),
}))

const staleCodeRule = "STALE CODE RULE: use tabs"
const freshCodeRule = "FRESH CODE RULE: use spaces"
const architectRule = "ARCHITECT-ONLY RULE: draw diagrams"

describe("Task instruction refresh after condensation (end-to-end through the real loader)", () => {
	let task: Task
	let createSpy: import("vitest").MockInstance<ApiHandler["createMessage"]>
	let manageSpy: import("vitest").MockInstance<typeof contextManagement.manageContext>
	const spies: Array<{ mockRestore(): void }> = []
	let codeRulePath: string

	beforeEach(() => {
		const context = {
			globalState: { get: vi.fn(), update: vi.fn().mockResolvedValue(undefined), keys: () => [] },
			workspaceState: { get: vi.fn(), update: vi.fn().mockResolvedValue(undefined), keys: () => [] },
			secrets: { get: vi.fn().mockResolvedValue(undefined), store: vi.fn(), delete: vi.fn() },
			globalStorageUri: { fsPath: path.join(os.tmpdir(), "instruction-refresh-e2e") },
			extensionUri: { fsPath: "/mock/extension/path" },
			extensionPath: "/mock/extension/path",
			extension: { packageJSON: { version: "1.0.0" } },
		} as unknown as vscode.ExtensionContext
		const outputChannel = { appendLine: vi.fn(), append: vi.fn(), clear: vi.fn(), show: vi.fn() } as any
		const provider = new ClineProvider(context, outputChannel, "sidebar", new ContextProxy(context)) as any
		provider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		provider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		provider.postStateToWebviewWithoutTaskHistory = vi.fn().mockResolvedValue(undefined)
		provider.getState = vi.fn().mockResolvedValue({ mcpEnabled: false, mode: "code" })

		const apiConfiguration: ProviderSettings = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
			apiKey: "test-api-key",
		}
		task = new Task({ provider, apiConfiguration, startTask: false })

		virtualFiles.clear()
		codeRulePath = path.resolve(task.cwd, ".roo", "rules-code", "style.md")
		virtualFiles.set(codeRulePath, staleCodeRule)
		virtualFiles.set(path.resolve(task.cwd, ".roo", "rules-architect", "plan.md"), architectRule)

		spies.push(
			vi.spyOn(task, "getTokenUsage").mockReturnValue({ contextTokens: 0 } as ReturnType<Task["getTokenUsage"]>),
			vi.spyOn(task, "flushPendingToolResultsToHistory").mockResolvedValue(true),
			vi.spyOn(task as any, "overwriteApiConversationHistory").mockImplementation(async (messages: any) => {
				task.apiConversationHistory = messages
			}),
			vi.spyOn(task as any, "getFilesReadByRooSafely").mockResolvedValue([]),
			vi.spyOn(task as any, "processQueuedMessages").mockImplementation(() => {}),
			vi.spyOn(task, "say").mockResolvedValue(undefined),
			vi.spyOn(buildTools, "buildNativeToolsArrayWithRestrictions").mockResolvedValue({ tools: [] } as any),
		)
		createSpy = vi.spyOn(task.api, "createMessage").mockImplementation(async function* () {
			yield { type: "text", text: "ok" }
		})
		manageSpy = vi.spyOn(contextManagement, "manageContext").mockImplementation(async ({ messages }) => ({
			messages,
			cost: 0,
			prevContextTokens: 10,
			summary: "",
		}))
		spies.push(createSpy, manageSpy)
		task.apiConversationHistory = [{ role: "user", content: "continue" }]
	})

	afterEach(() => {
		task.dispose()
		for (const spy of spies.splice(0)) spy.mockRestore()
		Task.resetGlobalApiRequestTime()
	})

	async function request() {
		for await (const _chunk of task.attemptApiRequest(0, { skipProviderRateLimit: true })) {
		}
		return createSpy.mock.calls.at(-1)![0]
	}

	function expectFreshModeRulesOnly(systemPrompt: string) {
		expect(systemPrompt).toContain(freshCodeRule)
		expect(systemPrompt).not.toContain(staleCodeRule)
		expect(systemPrompt).not.toContain(architectRule)
	}

	it("baseline: the code mode prompt loads .roo/rules-code and excludes .roo/rules-architect", async () => {
		const systemPrompt = await request()
		expect(systemPrompt).toContain(staleCodeRule)
		expect(systemPrompt).not.toContain(architectRule)
	})

	it("automatic condensation: a rule edited while condensing is in the first continuation request", async () => {
		expect(await request()).toContain(staleCodeRule)

		vi.mocked(task.getTokenUsage).mockReturnValue({ contextTokens: 10 } as ReturnType<Task["getTokenUsage"]>)
		manageSpy.mockImplementationOnce(async ({ messages }) => {
			virtualFiles.set(codeRulePath, freshCodeRule)
			return { messages, summary: "summary still quoting STALE CODE RULE", cost: 0, prevContextTokens: 10 }
		})
		const continuationPrompt = await request()

		expect(manageSpy).toHaveBeenCalledTimes(1)
		expectFreshModeRulesOnly(continuationPrompt)
		expect(task["pendingInstructionRefresh"]).toBe(false)
	})

	it("manual condensation: a rule edited while continuation waits is in the next request", async () => {
		expect(await request()).toContain(staleCodeRule)

		await task.condenseContext()
		expect(task["pendingInstructionRefresh"]).toBe(true)
		virtualFiles.set(codeRulePath, freshCodeRule)
		const continuationPrompt = await request()

		expectFreshModeRulesOnly(continuationPrompt)
		expect(task["pendingInstructionRefresh"]).toBe(false)
	})
})
