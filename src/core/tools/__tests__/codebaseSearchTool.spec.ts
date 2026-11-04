import { CodebaseSearchTool } from "../CodebaseSearchTool"
import { CodeIndexManager } from "../../../services/code-index/manager"
import type { Task } from "../../task/Task"

vi.mock("../../../services/code-index/manager", () => ({ CodeIndexManager: { getInstance: vi.fn() } }))
vi.mock("../../../utils/path", () => ({ getWorkspacePath: () => "/workspace" }))
vi.mock("vscode", () => ({ workspace: { asRelativePath: (file: string) => file } }))

describe("CodebaseSearchTool search envelope", () => {
	it.each([true, false])("reports every failed path and payload fields, matches: %s", async (matches) => {
		const failedFiles = ["src/failed.ts", "lib/also-failed.ts"]
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
		const searchIndex = vi.fn().mockResolvedValue({ results, partial: true, failedFiles })
		vi.mocked(CodeIndexManager.getInstance).mockReturnValue({
			isFeatureEnabled: true,
			isFeatureConfigured: true,
			searchIndex,
		} as unknown as CodeIndexManager)
		const task = {
			cwd: "/workspace",
			consecutiveMistakeCount: 1,
			say: vi.fn(),
			providerRef: { deref: () => ({ context: {} }) },
		}
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		await new CodebaseSearchTool().execute({ query: "query", path: "src" }, task as unknown as Task, callbacks)
		expect(searchIndex).toHaveBeenCalledWith("query", "src")
		expect(callbacks.handleError).not.toHaveBeenCalled()
		const output = callbacks.pushToolResult.mock.calls[0][0]
		expect(output).toContain("Partial index")
		for (const file of failedFiles) expect(output).toContain(file)
		expect(output).toContain(matches ? "Code Chunk: code" : "No relevant code snippets")
		expect(task.say).toHaveBeenCalledOnce()
		expect(JSON.parse(task.say.mock.calls[0][1])).toMatchObject({
			tool: "codebaseSearch",
			content: { query: "query", partial: true, failedFiles },
		})
	})

	it("includes complete empty envelopes in the displayed payload without a partial notice", async () => {
		vi.mocked(CodeIndexManager.getInstance).mockReturnValue({
			isFeatureEnabled: true,
			isFeatureConfigured: true,
			searchIndex: vi.fn().mockResolvedValue({ results: [], partial: false, failedFiles: [] }),
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
		})
	})
})
