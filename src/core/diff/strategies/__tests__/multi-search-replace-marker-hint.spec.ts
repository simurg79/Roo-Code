import { MultiSearchReplaceDiffStrategy } from "../multi-search-replace"

// Guards the POST-FAILURE "LIKELY CAUSE" hint for mistyped start-line markers.
// The heuristic must never act as an upfront rejection gate.
describe("MultiSearchReplaceDiffStrategy malformed start-line marker hint", () => {
	let strategy: MultiSearchReplaceDiffStrategy

	beforeEach(() => {
		strategy = new MultiSearchReplaceDiffStrategy()
	})

	const nonMatchingFile = ["alpha", "beta", "gamma", "delta", "epsilon"].join("\n")

	function buildDiff(searchBody: string, replaceBody: string): string {
		return `<<<<<<< SEARCH\n${searchBody}\n=======\n${replaceBody}\n>>>>>>> REPLACE`
	}

	it("uses requested totals for progress and clamps failed totals", () => {
		const block = {
			type: "tool_use" as const,
			name: "apply_diff" as const,
			params: { diff: "inline SEARCH" },
			partial: false,
		}
		expect(
			strategy.getProgressStatus(block, {
				success: true,
				content: "updated",
				blockCount: 3,
				failParts: [
					{ success: true, content: "applied" },
					{ success: false, error: "failure" },
				],
			}).text,
		).toBe("2/3")
		expect(
			strategy.getProgressStatus(block, {
				success: false,
				blockCount: 0,
				failParts: [{ success: false, error: "failure" }],
			}).text,
		).toBe("0/0")
	})

	function firstFailureError(result: Awaited<ReturnType<MultiSearchReplaceDiffStrategy["applyDiff"]>>): string {
		expect(result.success).toBe(false)
		const failures = result.failParts ?? []
		expect(failures.length).toBeGreaterThan(0)
		const failure = failures[0]
		if (failure.success || !failure.error) throw new Error("Expected a failed block with diagnostics")
		return failure.error
	}

	it("adds LIKELY CAUSE when the first search line is a bare ':3' marker and the block fails", async () => {
		const diffContent = buildDiff(":3\nnot-in-the-file", "replacement")
		const result = await strategy.applyDiff(nonMatchingFile, diffContent)

		const errorText = firstFailureError(result)
		expect(errorText).toContain("LIKELY CAUSE")
		expect(errorText).toContain(":start_line:")
	})

	const markerVariants = ["start_line:3", ":start-line 3", ": start_line : 3", ":START_LINE:3", "Start_Line: 3"]

	it.each(markerVariants)("adds LIKELY CAUSE for the malformed marker variant %j", async (markerVariant) => {
		const diffContent = buildDiff(`${markerVariant}\nnot-in-the-file`, "replacement")
		const result = await strategy.applyDiff(nonMatchingFile, diffContent)

		expect(firstFailureError(result)).toContain("LIKELY CAUSE")
	})

	it("still applies cleanly when the file genuinely contains a ':3' line (hint is not a gate)", async () => {
		const fileWithMarkerLikeLine = ["alpha", ":3", "beta", "gamma"].join("\n")
		const diffContent = buildDiff(":3\nbeta", ":3\nBETA")

		const result = await strategy.applyDiff(fileWithMarkerLikeLine, diffContent)

		expect(result.success).toBe(true)
		if (!result.success) throw new Error("Expected literal marker-like content to match")
		expect(result.content).toBe("alpha\n:3\nBETA\ngamma")
		expect(result.failParts ?? []).toHaveLength(0)
		expect(result.blockCount).toBe(1)
	})

	it("omits the hint for ordinary non-matching content but keeps the file-changed tip", async () => {
		const diffContent = buildDiff("completely unrelated content\nsecond line", "replacement")
		const result = await strategy.applyDiff(nonMatchingFile, diffContent)

		const errorText = firstFailureError(result)
		expect(errorText).not.toContain("LIKELY CAUSE")
		expect(errorText).toContain("the file content may have changed")
	})

	it("does not flag the correct ':start_line:3' marker form", async () => {
		const diffContent = `<<<<<<< SEARCH\n:start_line:3\n-------\nnot-in-the-file\n=======\nreplacement\n>>>>>>> REPLACE`
		const result = await strategy.applyDiff(nonMatchingFile, diffContent)

		expect(firstFailureError(result)).not.toContain("LIKELY CAUSE")
	})

	it("adds LIKELY CAUSE when a well-formed ':start_line:N' line goes unparsed and swallows its separator", async () => {
		// Indenting the marker makes the parser miss it, so both it and the "-------" become search text.
		const diffContent = buildDiff("  :start_line:3\n-------\nnot-in-the-file", "replacement")
		const result = await strategy.applyDiff(nonMatchingFile, diffContent)

		const errorText = firstFailureError(result)
		expect(errorText).toContain("LIKELY CAUSE")
		expect(errorText).toContain('together with the "-------" line after it')
	})
	it.each([": 3", ":42", "startline:3", "start_line:42"])("does not echo marker %j", async (marker) => {
		const error = firstFailureError(
			await strategy.applyDiff(nonMatchingFile, buildDiff(`${marker}\nmissing`, "new")),
		)
		expect(error).toContain("LIKELY CAUSE")
		expect(error).not.toContain(marker)
	})

	it.each([64, 65])("guards the trimmed first line boundary (%s)", async (length) => {
		const marker = `startline${" ".repeat(length - 10)}3`
		const error = firstFailureError(
			await strategy.applyDiff(nonMatchingFile, buildDiff(`  ${marker}  \nmissing`, "new")),
		)
		expect(error.includes("LIKELY CAUSE")).toBe(length === 64)
	})

	it.each(["value:3", ":3 trailing", "x start_line:3"])("requires the entire first line (%j)", async (line) => {
		const error = firstFailureError(await strategy.applyDiff(nonMatchingFile, buildDiff(`${line}\nmissing`, "new")))
		expect(error).not.toContain("LIKELY CAUSE")
	})

	it("reports a swallowed indented separator but not an absent separator", async () => {
		const withoutSeparator = firstFailureError(
			await strategy.applyDiff(nonMatchingFile, buildDiff(":3\nmissing", "new")),
		)
		expect(withoutSeparator).not.toContain("together with")
		const withSeparator = firstFailureError(
			await strategy.applyDiff(nonMatchingFile, buildDiff("  :3\n  -------\nmissing", "new")),
		)
		expect(withSeparator).toContain('together with the "-------" line after it')
	})

	it("keeps numeric similarity and reports totals on complete and partial failures", async () => {
		const failedDiff = buildDiff("alpha\nbetx", "new")
		const failedResult = await strategy.applyDiff(nonMatchingFile, failedDiff)
		const error = firstFailureError(failedResult)
		expect(error).toMatch(/\((\d+)% similar, needs 100%\)/)
		expect(error).toContain("- Similarity Score:")
		expect(failedResult.blockCount).toBe(1)
		const partialResult = await strategy.applyDiff(nonMatchingFile, buildDiff("alpha", "ALPHA") + "\n" + failedDiff)
		expect(partialResult.success).toBe(true)
		expect(partialResult.blockCount).toBe(2)
	})

	it.each([
		"<<<<<<< SEARCH>>PAYLOAD-SECRET\ncontent",
		"<<<<<<< SEARCH\ncontent\n>>>>>>> PAYLOAD-SECRET",
		"<<<<<<< SEARCH\ncontent\n=======\n:start_line:PAYLOAD-SECRET\n>>>>>>> REPLACE",
	])("excludes malformed marker payloads from every diagnostic (%j)", async (diff) => {
		const result = await strategy.applyDiff("FILE-SECRET", diff)
		expect(result.success).toBe(false)
		expect(JSON.stringify(result)).not.toMatch(/PAYLOAD-SECRET|FILE-SECRET/)
	})

	it("does not log search content for identical blocks", async () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const result = await strategy.applyDiff("FILE-SECRET", buildDiff("SEARCH-SECRET", "SEARCH-SECRET"))
			expect(JSON.stringify(result)).not.toMatch(/SEARCH-SECRET|FILE-SECRET/)
			expect(warning).not.toHaveBeenCalled()
		} finally {
			warning.mockRestore()
		}
	})

	it("scales linearly on long first search lines", async () => {
		const timings: number[] = []
		for (const multiplier of [1, 2, 4, 8]) {
			const diff = buildDiff(`startline${" ".repeat(4000 * multiplier)}3\nmissing`, "new")
			for (let iteration = 0; iteration < 10; iteration++) await strategy.applyDiff(nonMatchingFile, diff)
			const samples: number[] = []
			for (let sample = 0; sample < 5; sample++) {
				const startedAt = performance.now()
				for (let iteration = 0; iteration < 50; iteration++) {
					const result = await strategy.applyDiff(nonMatchingFile, diff)
					if (result.success) throw new Error("Expected a non-matching block")
				}
				samples.push(performance.now() - startedAt)
			}
			timings.push(samples.sort((left, right) => left - right)[2])
		}
		console.log("diff marker 1x/2x/4x/8x milliseconds:", timings.map((time) => time.toFixed(3)).join(" / "))
		expect(timings[2] / timings[0]).toBeLessThan(8)
		expect(timings[3] / timings[0]).toBeLessThan(16)
	})
})
