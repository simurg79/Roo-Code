import { CodebaseSearchTool } from "../CodebaseSearchTool"
import { CodeIndexManager } from "../../../services/code-index/manager"
import type { Task } from "../../task/Task"
import { SearchProviderRateLimitError } from "../../../services/code-index/shared/indexing-errors"
import englishEmbeddings from "../../../i18n/locales/en/embeddings.json"

vi.mock("../../../services/code-index/manager", () => ({ CodeIndexManager: { getInstance: vi.fn() } }))
vi.mock("../../../utils/path", () => ({ getWorkspacePath: () => "/workspace" }))
vi.mock("vscode", () => ({ workspace: { asRelativePath: (file: string) => file } }))

describe("CodebaseSearchTool search envelope", () => {
	it.each([true, false])("reports every failed path and payload fields, matches: %s", async (matches) => {
		const failedFiles = ["src/failed.ts", "lib/also-failed.ts"]
		const waitingFiles = ["src/waiting.ts"]
		const results = matches
			? [
					{
						id: "point",
						score: 0.9,
						payload: {
							filePath: "src/good.ts",
							startLine: 1,
							endLine: 2,
							codeChunk: " code ",
						},
					},
				]
			: []
		const searchIndex = vi.fn().mockResolvedValue({ results, partial: true, failedFiles, waitingFiles })
		vi.mocked(CodeIndexManager.getInstance).mockReturnValue({
			isFeatureEnabled: true,
			isFeatureConfigured: true,
			searchIndex,
		} as unknown as CodeIndexManager)
		const task = {
			cwd: "/workspace",
			consecutiveMistakeCount: 1,
			lifecycleSignal: new AbortController().signal,
			say: vi.fn(),
			providerRef: { deref: () => ({ context: {} }) },
		}
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		await new CodebaseSearchTool().execute({ query: "query", path: "src" }, task as unknown as Task, callbacks)
		expect(searchIndex).toHaveBeenCalledWith("query", "src", task.lifecycleSignal)
		expect(callbacks.handleError).not.toHaveBeenCalled()
		const output = callbacks.pushToolResult.mock.calls[0][0]
		expect(output).toContain("Partial index")
		for (const file of [...failedFiles, ...waitingFiles]) expect(output).toContain(file)
		expect(output).toContain("Failed files:")
		expect(output).toContain("Waiting files (indexing resumes automatically):")
		expect(output).toContain(matches ? "Code Chunk: code" : "No relevant code snippets")
		expect(task.say).toHaveBeenCalledOnce()
		expect(JSON.parse(task.say.mock.calls[0][1])).toMatchObject({
			tool: "codebaseSearch",
			content: { query: "query", partial: true, failedFiles, waitingFiles },
		})
	})

	it("surfaces provider rate limiting and automatic indexing recovery through handleError", async () => {
		const cause = Object.assign(new Error("raw provider error"), { status: 429, retryAfterMs: 120_000 })
		const error = new SearchProviderRateLimitError(englishEmbeddings.searchProviderRateLimited, cause)
		const searchIndex = vi.fn().mockRejectedValue(error)
		vi.mocked(CodeIndexManager.getInstance).mockReturnValue({
			isFeatureEnabled: true,
			isFeatureConfigured: true,
			searchIndex,
		} as unknown as CodeIndexManager)
		const task = {
			cwd: "/workspace",
			lifecycleSignal: new AbortController().signal,
			say: vi.fn(),
			providerRef: { deref: () => ({ context: {} }) },
		}
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		await new CodebaseSearchTool().execute({ query: "query" }, task as unknown as Task, callbacks)
		expect(callbacks.handleError).toHaveBeenCalledExactlyOnceWith("codebase_search", error)
		expect(error.message).toContain("provider rate-limited")
		expect(error.message).toContain("Indexing resumes automatically")
		expect(searchIndex).toHaveBeenCalledOnce()
		expect(task.say).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it("T27 reads the current lifecycle signal after approval on every call", async () => {
		const searchIndex = vi
			.fn()
			.mockResolvedValue({ results: [], partial: false, failedFiles: [], waitingFiles: [] })
		vi.mocked(CodeIndexManager.getInstance).mockReturnValue({
			isFeatureEnabled: true,
			isFeatureConfigured: true,
			searchIndex,
		} as unknown as CodeIndexManager)
		let controller = new AbortController()
		const originalSignal = controller.signal
		const task = {
			cwd: "/workspace",
			say: vi.fn(),
			providerRef: { deref: () => ({ context: {} }) },
			get lifecycleSignal() {
				return controller.signal
			},
		}
		const callbacks = {
			askApproval: vi.fn().mockImplementation(async () => {
				controller.abort()
				controller = new AbortController()
				return true
			}),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		const tool = new CodebaseSearchTool()
		await tool.execute({ query: "first" }, task as unknown as Task, callbacks)
		const resumedSignal = controller.signal
		expect(searchIndex).toHaveBeenNthCalledWith(1, "first", undefined, resumedSignal)
		expect(resumedSignal).not.toBe(originalSignal)
		await tool.execute({ query: "second", path: "src" }, task as unknown as Task, callbacks)
		expect(searchIndex).toHaveBeenNthCalledWith(2, "second", "src", controller.signal)
		expect(controller.signal).not.toBe(resumedSignal)
		expect(callbacks.handleError).not.toHaveBeenCalled()
	})

	it("includes complete empty envelopes in the displayed payload without a partial notice", async () => {
		vi.mocked(CodeIndexManager.getInstance).mockReturnValue({
			isFeatureEnabled: true,
			isFeatureConfigured: true,
			searchIndex: vi.fn().mockResolvedValue({ results: [], partial: false, failedFiles: [], waitingFiles: [] }),
		} as unknown as CodeIndexManager)
		const task = { cwd: "/workspace", say: vi.fn(), providerRef: { deref: () => ({ context: {} }) } }
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		await new CodebaseSearchTool().execute({ query: "query" }, task as unknown as Task, callbacks)
		expect(callbacks.pushToolResult).toHaveBeenCalledWith('No relevant code snippets found for the query: "query"')
		expect(JSON.parse(task.say.mock.calls[0][1]).content).toEqual({
			query: "query",
			results: [],
			partial: false,
			failedFiles: [],
			waitingFiles: [],
		})
	})
})
