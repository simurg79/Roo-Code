import fs from "fs/promises"
import path from "path"

import * as tools from "../../../shared/tools"
import type { DiffResult, ToolResponse } from "../../../shared/tools"
import type { Task } from "../../task/Task"
import { fileExistsAtPath } from "../../../utils/fs"
import { MultiSearchReplaceDiffStrategy } from "../../diff/strategies/multi-search-replace"
import type { ToolCallbacks } from "../BaseTool"
import { applyDiffTool } from "../ApplyDiffTool"

vi.mock("fs/promises", () => ({ default: { readFile: vi.fn() } }))
vi.mock("../../../utils/fs", () => ({ fileExistsAtPath: vi.fn() }))
vi.mock("../../../utils/path", () => ({ getReadablePath: vi.fn().mockReturnValue("test/file.txt") }))
vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((message: string) => `Error: ${message}`),
		rooIgnoreError: vi.fn((filePath: string) => `Access denied: ${filePath}`),
		createPrettyPatch: vi.fn(() => "mock-diff"),
	},
}))
vi.mock("../../diff/stats", () => ({
	sanitizeUnifiedDiff: vi.fn((diff: string) => diff),
	computeDiffStats: vi.fn(() => ({ additions: 1, deletions: 1 })),
}))
vi.mock("vscode", () => ({
	window: { showWarningMessage: vi.fn() },
	env: { openExternal: vi.fn() },
	Uri: { parse: vi.fn() },
}))

type FailPart = Extract<DiffResult, { success: false }>

describe("ApplyDiffTool failure reporting", () => {
	const testFilePath = "test/file.txt"
	let mockTask: Task
	let mockAskApproval: ReturnType<typeof vi.fn<ToolCallbacks["askApproval"]>>
	let mockHandleError: ReturnType<typeof vi.fn<ToolCallbacks["handleError"]>>
	let pushedResult: ToolResponse | undefined

	beforeEach(() => {
		vi.clearAllMocks()
		pushedResult = undefined
		vi.mocked(fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(fs.readFile).mockResolvedValue("line one\nline two\nline three\n")
		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn().mockResolvedValue(undefined)
		mockTask = {
			cwd: "/workspace",
			consecutiveMistakeCount: 0,
			consecutiveMistakeCountForApplyDiff: new Map<string, number>(),
			didEditFile: false,
			api: { getModel: () => ({ id: "claude-test" }) },
			rooIgnoreController: { validateAccess: vi.fn().mockReturnValue(true) },
			rooProtectedController: { isWriteProtected: vi.fn().mockReturnValue(false) },
			providerRef: {
				deref: vi.fn().mockReturnValue({
					getState: vi.fn().mockResolvedValue({ diagnosticsEnabled: true, writeDelayMs: 0, experiments: {} }),
				}),
			},
			diffViewProvider: {
				open: vi.fn(),
				update: vi.fn(),
				reset: vi.fn(),
				revertChanges: vi.fn(),
				saveChanges: vi.fn(),
				saveDirectly: vi.fn(),
				scrollToFirstDiff: vi.fn(),
				pushToolWriteResult: vi.fn().mockResolvedValue("Changes successfully applied."),
			},
			fileContextTracker: { trackFileContext: vi.fn() },
			say: vi.fn(),
			ask: vi.fn(),
			recordToolError: vi.fn(),
			processQueuedMessages: vi.fn(),
		} as unknown as Task
	})

	afterEach(() => vi.restoreAllMocks())

	function makeFailure(line = 1): FailPart {
		return {
			success: false,
			error: "RAW-ERROR-SECRET",
			details: { searchContent: "DETAIL-SECRET", bestMatch: "DETAIL-SECRET" },
			diagnostic: { reason: "no_match", line, similarity: 0.5, threshold: 1 },
		}
	}

	function makeFailures(count: number): FailPart[] {
		return Array.from({ length: count }, (_, index) => makeFailure(index + 1))
	}

	function buildDiff(count: number): string {
		return Array.from(
			{ length: count },
			(_, index) => `<<<<<<< SEARCH\nsearch-${index}\n=======\nreplace-${index}\n>>>>>>> REPLACE`,
		).join("\n")
	}

	async function runApplyDiff(result: DiffResult, count = 1, diffOverride?: string): Promise<string> {
		mockTask.diffStrategy = {
			getName: () => "test",
			applyDiff: vi.fn().mockResolvedValue(result),
			getProgressStatus: vi.fn().mockReturnValue({ icon: "diff-multiple", text: "x" }),
		}
		await applyDiffTool.execute({ path: testFilePath, diff: diffOverride ?? buildDiff(count) }, mockTask, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: (result) => {
				pushedResult = result
			},
		})
		expect(mockHandleError).not.toHaveBeenCalled()
		return String(pushedResult ?? "")
	}

	function allDiagnosticOutputs(output: string): string {
		return [
			output,
			...vi.mocked(mockTask.say).mock.calls.map((call) => String(call[1] ?? "")),
			...vi.mocked(mockTask.recordToolError).mock.calls.map((call) => String(call[1] ?? "")),
		].join("\n")
	}

	it("reports all failures, names the file and repeats the safe report on the second failure", async () => {
		const result: DiffResult = { success: false, failParts: makeFailures(2), blockCount: 2 }
		const firstOutput = await runApplyDiff(result, 2)
		expect(mockTask.say).not.toHaveBeenCalled()
		const output = await runApplyDiff(result, 2)
		expect(output).toBe(firstOutput)
		expect(output).toContain(`Unable to apply diff to file: ${path.resolve("/workspace", testFilePath)}`)
		expect(output).toContain("2 diff blocks failed to apply")
		expect(output).toContain("--- Failure 1 of 2 ---")
		expect(output).toContain("--- Failure 2 of 2 ---")
		expect(mockTask.say).toHaveBeenCalledWith("diff_error", output)
		expect(mockTask.recordToolError).toHaveBeenLastCalledWith("apply_diff", output)
		expect(allDiagnosticOutputs(output)).not.toMatch(/RAW-ERROR-SECRET|DETAIL-SECRET|Details:/)
	})

	it.each([false, true])("never forwards unstructured errors or details (partial=%s)", async (partial) => {
		const failure: FailPart = { success: false, error: "RAW-ERROR-SECRET", details: { bestMatch: "DETAIL-SECRET" } }
		const result: DiffResult = partial ? { success: true, content: "updated", failParts: [failure] } : failure
		await runApplyDiff(result, 2)
		const output = await runApplyDiff(result, 2)
		expect(allDiagnosticOutputs(output)).not.toMatch(/RAW-ERROR-SECRET|DETAIL-SECRET/)
		expect(output).toContain("Roo could not apply this diff block")
	})

	it("rejects text disguised as numeric diagnostic fields", async () => {
		const failure = makeFailure()
		failure.diagnostic = {
			reason: "no_match",
			line: "NUMERIC-SECRET" as unknown as number,
			similarity: "NUMERIC-SECRET" as unknown as number,
			threshold: Number.NaN,
		}
		const output = await runApplyDiff({ success: false, failParts: [failure] })
		expect(allDiagnosticOutputs(output)).not.toMatch(/NUMERIC-SECRET|NaN|undefined/)
		expect(output).toContain("No sufficiently similar match found")
	})

	it("does not stringify arbitrary detail objects", async () => {
		const failure = makeFailure()
		failure.details = {
			get bestMatch(): string {
				throw new Error("must not read details")
			},
		}
		const output = await runApplyDiff({ success: false, failParts: [failure] })
		expect(output).toContain("No sufficiently similar match found at line: 1")
	})

	it.each([5, 6, 8, 50, 51, 60])("bounds entries without losing the total (%s)", async (count) => {
		const output = await runApplyDiff({ success: false, failParts: makeFailures(count) }, count)
		expect(output).toContain(`${count} diff blocks failed to apply`)
		expect(output.match(/--- Failure /g)).toHaveLength(Math.min(count, 50))
		expect(output.match(/- Similarity Score:/g)).toHaveLength(5)
		if (count > 5) {
			expect(output).toContain(`(Failures 6-${Math.min(count, 50)} are shown as a single summary line each`)
		} else {
			expect(output).not.toContain("are shown as a single summary line each")
		}
		if (count > 50) {
			expect(output).toContain(`(+${count - 50} more failures not shown`)
			expect(output).not.toContain("--- Failure 51")
		} else {
			expect(output).not.toContain("more failures not shown")
		}
	})

	it("counts and renders only unsuccessful parts", async () => {
		const parts: DiffResult[] = [{ success: true, content: "applied" }, makeFailure(), makeFailure(2)]
		const output = await runApplyDiff({ success: false, failParts: parts }, 3)
		expect(output).toContain("2 diff blocks failed")
		expect(output).toContain("--- Failure 2 of 2 ---")
	})

	it("omits headings and trailers for one failure and tolerates empty failures", async () => {
		const output = await runApplyDiff({ success: false, failParts: [makeFailure()] })
		expect(output).not.toContain("--- Failure")
		expect(output).not.toContain("are shown as a single summary")
		const emptyOutput = await runApplyDiff({ success: false, failParts: [], error: "secret" })
		expect(emptyOutput).toContain("Roo could not apply")
		expect(emptyOutput).not.toContain("secret")
	})

	it.each([3999, 4000, 4001, 6016])("caps detailed text including its heading at 4000 (%s)", async (length) => {
		const heading = "--- Failure 1 of 2 ---\n"
		const detail = "x".repeat(length - heading.length)
		vi.spyOn(tools, "formatDiffFailure").mockReturnValue(detail)
		const output = await runApplyDiff({ success: false, failParts: makeFailures(2) }, 2)
		expect(output).toContain((heading + detail).slice(0, 4000))
		if (length > 4000) {
			expect(output).toContain(`[truncated; ${length - 4000} characters omitted`)
			expect(output).not.toContain(heading + detail)
		} else {
			expect(output).not.toContain("[truncated")
		}
	})

	it.each([199, 200, 201])("caps only the first summary line at 200 (%s)", async (length) => {
		vi.spyOn(tools, "formatDiffFailure").mockReturnValue("y".repeat(length) + "\nSECOND-LINE")
		const output = await runApplyDiff({ success: false, failParts: makeFailures(6) }, 6)
		const sixthEntry = output.slice(output.indexOf("--- Failure 6 of 6 ---"))
		expect(sixthEntry).toContain("y".repeat(Math.min(length, 200)))
		expect(sixthEntry).not.toContain("SECOND-LINE")
		if (length > 200) expect(sixthEntry).toContain("[truncated; 1 characters omitted")
		else expect(sixthEntry).not.toContain("[truncated")
	})

	it.each(["\n", "\r\n"])("counts only line-level markers with %j endings", async (lineEnding) => {
		const diff = [
			"<<<<<<< SEARCH>  ",
			"\\<<<<<<< SEARCH",
			"inline <<<<<<< SEARCH",
			"<<<<<<< SEARCHING",
			"=======",
			"replacement",
			">>>>>>> REPLACE",
			buildDiff(1),
		]
			.join("\n")
			.replace(/\n/g, lineEnding)
		const output = await runApplyDiff({ success: true, content: "updated", failParts: [makeFailure()] }, 2, diff)
		expect(output).toContain("Applied 1 of 2 diff blocks")
	})

	it("prefers the requested total and asks only for still-needed failed edits", async () => {
		const output = await runApplyDiff({
			success: true,
			content: "updated",
			failParts: [makeFailure()],
			blockCount: 3,
		})
		expect(output).toContain("Applied 2 of 3 diff blocks")
		expect(output).toContain("The other 1 did NOT apply.")
		expect(output).toContain("resend ONLY the failed blocks that are still needed")
		expect(output).toContain("Roo has already applied the successful blocks")
		expect(output).not.toMatch(/NOT in the file|re-apply/)
	})

	it.each([2, 3, 51])("clamps applied totals and counts omitted failures (%s)", async (count) => {
		const output = await runApplyDiff({
			success: true,
			content: "updated",
			failParts: makeFailures(count),
			blockCount: 2,
		})
		expect(output).toContain("Applied 0 of 2 diff blocks")
		expect(output).toContain(`The other ${count} did NOT apply.`)
		expect(output).not.toMatch(/Applied -\d/)
		if (count === 51) expect(output).toContain("(+1 more failures not shown")
	})

	it.each([0, 1])("preserves successful output without partial guidance (%s)", async (count) => {
		const output = await runApplyDiff(
			{ success: true, content: "updated" },
			count,
			count ? undefined : "no markers",
		)
		expect(output).toContain("Changes successfully applied.")
		expect(output).not.toContain("Applied")
		expect(output.includes("Making multiple related changes")).toBe(count === 1)
	})

	it.each([1, 3])("excludes file and search text with the real strategy (%s failures)", async (count) => {
		const original = "header\nFILE-SECRET-BESTMATCH\nFILE-SECRET-ORIGINAL\nfooter"
		const failureDiff = Array.from(
			{ length: count },
			() => "<<<<<<< SEARCH\n:start_line:2\n-------\nSEARCH-SECRET\n=======\nreplacement\n>>>>>>> REPLACE",
		).join("\n")
		const strategy = new MultiSearchReplaceDiffStrategy()
		for (const partial of [false, true]) {
			const diff = partial
				? "<<<<<<< SEARCH\nheader\n=======\nupdated\n>>>>>>> REPLACE\n" + failureDiff
				: failureDiff
			const result = await strategy.applyDiff(original, diff)
			await runApplyDiff(result, 0, diff)
			const output = await runApplyDiff(result, 0, diff)
			expect(allDiagnosticOutputs(output)).not.toMatch(
				/FILE-SECRET|SEARCH-SECRET|Search Content:|Best Match Found:|Original Content:/,
			)
			expect(output).toContain("No sufficiently similar match found at line: 2")
			if (partial) expect(output).toContain(`Applied 1 of ${count + 1} diff blocks`)
		}
	})
})
