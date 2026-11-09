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
import { STARTUP_READING_NOTE, getEffectiveApiHistory } from "../../condense"
import { readApiMessages, type ApiMessage } from "../../task-persistence/apiMessages"
import * as fs from "fs/promises"
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
		access: vi.fn().mockImplementation(async (target: string) => {
			if (!virtualFiles.has(path.resolve(target)) && !isVirtualDirectory(target)) throw missing()
		}),
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
vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (filePath: string, data: unknown) => {
		virtualFiles.set(path.resolve(filePath), JSON.stringify(data))
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
	let saySpy: import("vitest").MockInstance<Task["say"]>
	let summaryText: string
	let duringSummary: () => void
	let failNormalRequest: boolean
	let providerState: {
		mcpEnabled: boolean
		mode: string
		autoCondenseContext: boolean
		autoCondenseContextPercent: number
		customSupportPrompts?: { CONDENSE: string }
	}
	const startupInstructions =
		"Before task work, read referenced rule startup/rules.md and load applicable skill startup-check."

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
		providerState = { mcpEnabled: false, mode: "code", autoCondenseContext: true, autoCondenseContextPercent: 50 }
		provider.getState = vi.fn(async () => providerState)
		summaryText = "summary still quoting STALE CODE RULE"
		duringSummary = () => {}
		failNormalRequest = false

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
			vi.spyOn(task.api, "countTokens").mockResolvedValue(10),
			vi.spyOn(task as any, "getFilesReadByRooSafely").mockResolvedValue([]),
			vi.spyOn(task as any, "processQueuedMessages").mockImplementation(() => {}),
			vi.spyOn(buildTools, "buildNativeToolsArrayWithRestrictions").mockResolvedValue({ tools: [] } as any),
		)
		saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined)
		createSpy = vi.spyOn(task.api, "createMessage").mockImplementation(async function* (systemPrompt) {
			if (systemPrompt.includes("This is a summarization-only request")) {
				duringSummary()
				vi.mocked(task.getTokenUsage).mockReturnValue({ contextTokens: 0 } as ReturnType<Task["getTokenUsage"]>)
				yield { type: "text", text: summaryText.slice(0, 12) }
				yield { type: "text", text: summaryText.slice(12) }
			} else {
				if (failNormalRequest) {
					failNormalRequest = false
					throw new Error("temporary provider failure")
				}
				yield { type: "text", text: "ok" }
			}
		})
		manageSpy = vi.spyOn(contextManagement, "manageContext")
		spies.push(createSpy, manageSpy, saySpy)
		task.apiConversationHistory = [
			{ role: "user", content: "continue", ts: 1 },
			{ role: "assistant", content: "Earlier rule and skill reading completed.", ts: 2 },
			{ role: "user", content: "Resume task work", ts: 3 },
		]
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

		vi.mocked(task.getTokenUsage).mockReturnValue({ contextTokens: 160000 } as ReturnType<Task["getTokenUsage"]>)
		duringSummary = () => virtualFiles.set(codeRulePath, freshCodeRule)
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

	function normalCalls() {
		return createSpy.mock.calls.filter(
			([systemPrompt]) => !systemPrompt.includes("This is a summarization-only request"),
		)
	}

	function expectOneNote(messages: Pick<ApiMessage, "content">[]) {
		expect(STARTUP_READING_NOTE).toBe(`<system-reminder>
## Startup Reading
Context was condensed. Rule files and skills you read earlier are no longer in context.
Before continuing the task, redo the startup reading your current mode's instructions require,
as you would at mode start, using your usual tools. If they require none, continue the task.
</system-reminder>`)
		const textBlocks = messages.flatMap(({ content }) =>
			typeof content === "string"
				? [content]
				: content.filter((block) => block.type === "text").map((block) => block.text),
		)
		expect(textBlocks.filter((text) => text === STARTUP_READING_NOTE)).toHaveLength(1)
	}

	async function persistedHistory() {
		const messages = await readApiMessages({ taskId: task.taskId, globalStoragePath: task["globalStoragePath"] })
		expect(messages).toEqual(task.apiConversationHistory)
		return messages
	}

	async function condenseAndContinue(trigger: string) {
		if (trigger === "manual") {
			await task.condenseContext()
			expectOneNote(getEffectiveApiHistory(await persistedHistory()))
		} else {
			vi.mocked(task.getTokenUsage).mockReturnValue({ contextTokens: 160000 } as ReturnType<
				Task["getTokenUsage"]
			>)
			if (trigger === "recovery") {
				await task["handleContextWindowExceededError"]()
				expectOneNote(getEffectiveApiHistory(await persistedHistory()))
			}
		}
		await request()
		expectOneNote(getEffectiveApiHistory(await persistedHistory()))
		expectOneNote(normalCalls().at(-1)![1])
	}

	// The claimed-reading wording runs once: startup-reading-note.spec.ts covers it at unit level.
	it.each([
		...["manual", "automatic", "recovery"].map((trigger) => ({
			trigger,
			wording: "summary omits reading guidance",
		})),
		{ trigger: "manual", wording: "summary claims completed reading" },
	])(
		"$trigger real chain persists the note with current startup instructions when $wording (AC14/17)",
		async ({ trigger, wording }) => {
			virtualFiles.set(codeRulePath, `${staleCodeRule}\n${startupInstructions}`)
			summaryText =
				wording === "summary claims completed reading"
					? "Task in progress. All startup rule and skill reading was completed."
					: "Task in progress. Continue implementing the requested feature."
			duringSummary = () => virtualFiles.set(codeRulePath, `${freshCodeRule}\n${startupInstructions}`)
			await condenseAndContinue(trigger)
			const [systemPrompt, messages] = normalCalls().at(-1)!
			expectFreshModeRulesOnly(systemPrompt)
			expect(systemPrompt).toContain(startupInstructions)
			expect(JSON.stringify(messages)).toContain(summaryText)
			expect(
				createSpy.mock.calls.filter(([prompt]) => prompt.includes("This is a summarization-only request")),
			).toHaveLength(1)
			if (trigger !== "manual") expect(manageSpy).toHaveBeenCalledTimes(1)
			expect(task["pendingInstructionRefresh"]).toBe(false)
		},
	)

	it("a real first-chunk API retry retains exactly one note and the current startup instructions", async () => {
		virtualFiles.set(codeRulePath, `${freshCodeRule}\n${startupInstructions}`)
		await task.condenseContext()
		failNormalRequest = true
		const askSpy = vi.spyOn(task, "ask").mockResolvedValue({ response: "yesButtonClicked" })
		spies.push(askSpy)
		await request()
		expect(normalCalls()).toHaveLength(2)
		for (const [systemPrompt, messages] of normalCalls()) {
			expect(systemPrompt).toContain(startupInstructions)
			expectOneNote(messages)
		}
		expect(askSpy).toHaveBeenCalledExactlyOnceWith("api_req_failed", "temporary provider failure")
		expectOneNote(await persistedHistory())
	})

	it("automatic trigger: custom condensing prompt cannot suppress the note", async () => {
		const customPrompt = "Summarize in one sentence; omit startup-reading reminders."
		providerState.customSupportPrompts = { CONDENSE: customPrompt }
		await condenseAndContinue("automatic")
		const summaryCall = createSpy.mock.calls.find(([prompt]) =>
			prompt.includes("This is a summarization-only request"),
		)!
		expect(summaryCall[1].at(-1)?.content).toBe(customPrompt)
	})

	// Recovery shares manual's initial refresh-mode build; automatic covers the post-condense rebuild.
	it.each(["manual", "automatic"])(
		"%s unreadable refresh source warns before the normal request without suppressing the note (AC20)",
		async (trigger) => {
			virtualFiles.set(path.resolve(task.cwd, ".roo", "rules", "startup.md"), startupInstructions)
			const ordinaryRead = vi.mocked(fs.readFile).getMockImplementation()!
			duringSummary = () => {
				vi.mocked(fs.readFile).mockImplementation(async (...parameters: Parameters<typeof fs.readFile>) => {
					if (path.resolve(String(parameters[0])) === codeRulePath) {
						throw Object.assign(new Error("unreadable rule"), { code: "EACCES" })
					}
					return ordinaryRead(...parameters)
				})
			}
			try {
				await condenseAndContinue(trigger)
				const warningIndex = saySpy.mock.calls.findIndex(([type]) => type === "instruction_refresh_warning")
				expect(warningIndex).toBeGreaterThanOrEqual(0)
				expect(saySpy.mock.calls[warningIndex][1]).toContain(`${codeRulePath} (EACCES)`)
				expect(saySpy.mock.calls[warningIndex][6]).toEqual({ isNonInteractive: true })
				expect(saySpy.mock.invocationCallOrder[warningIndex]).toBeLessThan(
					createSpy.mock.invocationCallOrder.at(-1)!,
				)
				expect(normalCalls().at(-1)![0]).toContain(startupInstructions)
				expect(normalCalls().at(-1)![0]).not.toContain(staleCodeRule)
				expect(saySpy.mock.calls.filter(([type]) => type === "instruction_refresh_warning")).toHaveLength(1)
			} finally {
				vi.mocked(fs.readFile).mockImplementation(ordinaryRead)
			}
		},
	)

	it("two real condensations persist both summaries but send only the latest note", async () => {
		await condenseAndContinue("manual")
		task.apiConversationHistory.push(
			{ role: "assistant", content: "Continued work", ts: 5 },
			{ role: "user", content: "Next step", ts: 6 },
		)
		await condenseAndContinue("manual")
		const messages = await persistedHistory()
		expect(messages.filter((message) => message.isSummary)).toHaveLength(2)
		expectOneNote(getEffectiveApiHistory(messages))
	})

	// The empty-summary case is covered at unit level and follows the same error path as "failed".
	it.each(["skipped", "failed", "truncation", "below threshold"])(
		"%s real outcome adds no startup-reading note",
		async (outcome) => {
			if (outcome === "skipped") task.apiConversationHistory = task.apiConversationHistory.slice(0, 1)
			if (outcome === "failed") {
				createSpy.mockImplementationOnce(async function* () {
					yield { type: "text", text: "Partial summary" }
					throw new Error("summary provider failed")
				})
			}
			if (outcome === "truncation" || outcome === "below threshold") {
				providerState.autoCondenseContext = false
				if (outcome === "truncation") {
					task.apiConversationHistory.push(
						{ role: "assistant", content: "More work", ts: 4 },
						{ role: "user", content: "Continue again", ts: 5 },
					)
				}
				vi.mocked(task.getTokenUsage).mockReturnValue({
					contextTokens: outcome === "truncation" ? 190000 : 10,
				} as ReturnType<Task["getTokenUsage"]>)
			} else {
				await task.condenseContext()
				expect(saySpy.mock.calls.some(([type]) => type === "condense_context_error")).toBe(true)
			}
			await request()
			expect(task.apiConversationHistory.some((message) => message.isSummary)).toBe(false)
			expect(JSON.stringify(task.apiConversationHistory)).not.toContain("## Startup Reading")
			expect(JSON.stringify(normalCalls().at(-1)![1])).not.toContain("## Startup Reading")
			expect(task["pendingInstructionRefresh"]).toBe(false)
			if (outcome === "truncation") {
				expect(task.apiConversationHistory.some((message) => message.isTruncationMarker)).toBe(true)
				expect(await persistedHistory()).toEqual(task.apiConversationHistory)
			}
		},
	)
})
