import { performance } from "node:perf_hooks"
import * as vscode from "vscode"
import { extractLeakedToolCalls, middleOutTruncate, VsCodeLmHandler } from "../vscode-lm"
import { checkContextWindowExceededError } from "../../../core/context/context-management/context-error-handling"
import { QuotingScanState } from "../vscode-lm-quoting"

vi.mock("vscode", () => {
	class LanguageModelTextPart {
		constructor(public value: string) {}
	}
	class LanguageModelDataPart {
		constructor(
			public data: Uint8Array,
			public mimeType: string,
		) {}
		static image(data: Uint8Array, mimeType: string) {
			return new LanguageModelDataPart(data, mimeType)
		}
	}
	class LanguageModelToolCallPart {
		constructor(
			public callId: string,
			public name: string,
			public input: object,
		) {}
	}
	class LanguageModelToolResultPart {
		constructor(
			public callId: string,
			public content: unknown[],
		) {}
	}
	class LanguageModelChatMessage {
		constructor(public content: unknown) {}
		static Assistant(content: unknown) {
			return new LanguageModelChatMessage(content)
		}
		static User(content: unknown) {
			return new LanguageModelChatMessage(content)
		}
	}
	return {
		LanguageModelTextPart,
		LanguageModelDataPart,
		LanguageModelToolCallPart,
		LanguageModelToolResultPart,
		LanguageModelChatMessage,
		workspace: { onDidChangeConfiguration: () => ({ dispose() {} }) },
		lm: { selectChatModels: async () => [] },
		CancellationTokenSource: class {
			token = { isCancellationRequested: false }
			cancel() {
				this.token.isCancellationRequested = true
			}
			dispose() {}
		},
		CancellationError: class extends Error {},
	}
})

const invocation = (value: string) => `<invoke name="tool"><parameter name="value">${value}</parameter></invoke>`
const wrapped = (value: string) => `<function_calls>${invocation(value)}</function_calls>`
const tools = new Map([["tool", { type: "object", properties: { value: { type: "string" } } }]])

const corpus = [
	"ordinary prose",
	wrapped("[1,2]"),
	invocation("bare"),
	wrapped("x") + " trailing narration",
	"FOR EXAMPLE " + wrapped("x"),
	"Do not. Proceed: " + wrapped("x"),
	"```xml\n" + wrapped("x") + "\n```",
	"~~~\n" + wrapped("x") + "\n~~~",
	"`` example ` " + wrapped("x") + " ``",
	wrapped("x") + "\n" + wrapped("y"),
	"<function_calls>" + invocation("x") + "\n" + invocation("y") + "</function_calls>",
	'<function_calls><invoke name="unknown"></invoke></function_calls>',
	'<function_calls><invoke name="tool"><parameter name="value">unfinished',
	...["e.g. ", "E.G. ", "Use, e.g.", "e.g.: "].map((prefix) => prefix + wrapped("x")),
]

describe("compatibility acceptance and executable performance evidence", () => {
	beforeEach(() => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.spyOn(console, "debug").mockImplementation(() => {})
	})
	afterEach(() => vi.restoreAllMocks())

	it("logs the original strict token measurement error before replacing it", async () => {
		const handler = new VsCodeLmHandler({})
		const failure = new Error("Token service unavailable")
		handler["client"] = { countTokens: vi.fn().mockRejectedValue(failure) } as unknown as vscode.LanguageModelChat
		try {
			await expect(handler["countTokensStrict"](vscode.LanguageModelChatMessage.User("prompt"))).rejects.toThrow(
				"Roo Code <Language Model API>: Could not measure request size. The request was not sent.",
			)
			expect(console.warn).toHaveBeenCalledExactlyOnceWith(
				"Roo Code <Language Model API>: Request size measurement failed:",
				failure,
			)
		} finally {
			handler.dispose()
		}
	})

	it("pins the corpus verified against the approved one-shot reference", () => {
		const recovered = new Map<number, { values: string[]; leftover: string }>([
			[1, { values: ["[1,2]"], leftover: "" }],
			[5, { values: ["x"], leftover: "Do not. Proceed: " }],
			[9, { values: ["x", "y"], leftover: "\n" }],
			[10, { values: ["x", "y"], leftover: "\n" }],
		])
		for (const [index, text] of corpus.entries()) {
			const expected = recovered.get(index)
			expect(extractLeakedToolCalls(text, tools)).toEqual({
				calls: expected?.values.map((value) => ({ name: "tool", input: { value } })) ?? [],
				leftoverText: expected?.leftover ?? text,
			})
		}
	})

	it.each(["FOR EXAMPLE ", "Do not. Proceed: "])("honors the final-sentence cue for %s", (prefix) => {
		expect(extractLeakedToolCalls(prefix + wrapped("x"), tools).calls).toHaveLength(
			prefix.startsWith("FOR") ? 0 : 1,
		)
	})

	it.each(["e.g. ", "E.G. ", "Use, e.g.", "e.g.: "])("treats the e.g. cue in %s as a quoting guard", (prefix) => {
		expect(extractLeakedToolCalls(prefix + wrapped("x"), tools).calls).toHaveLength(0)
	})

	it("treats e.g. split across chunks as a quoting guard", () => {
		const state = new QuotingScanState()
		state.advance("e.")
		state.advance("g. ")
		expect(state.hasQuotingCue()).toBe(true)
	})

	it.each([
		"never",
		"not",
		"do not",
		"don't",
		"does not",
		"doesn't",
		"must not",
		"mustn't",
		"avoid",
		"instead of",
		"rather than",
		"for example",
		"e.g.",
		"such as",
		"like this",
		"as follows",
	])("preserves the cue %s across every split and expires it after later punctuation", (cue) => {
		const text = cue.toUpperCase() + " "
		for (let boundary = 0; boundary <= text.length; boundary++) {
			const state = new QuotingScanState()
			state.advance(text.slice(0, boundary))
			state.advance(text.slice(boundary))
			expect(state.hasQuotingCue()).toBe(true)
			for (const terminator of [".", "!", "?"]) {
				state.advance(terminator + " Proceed: ")
				expect(state.hasQuotingCue()).toBe(false)
			}
		}
	})

	it.each(["xe.g. ", "0e.g. ", "_e.g. "])("rejects the embedded cue in %s across every split", (text) => {
		for (let boundary = 0; boundary <= text.length; boundary++) {
			const state = new QuotingScanState()
			state.advance(text.slice(0, boundary))
			state.advance(text.slice(boundary))
			expect(state.hasQuotingCue()).toBe(false)
		}
	})

	it("measures bounded quoting scans on the 1x/2x/4x/8x ladder", () => {
		const originalMatchAll = String.prototype.matchAll
		const results: Array<{ multiplier: number; work: number; milliseconds: number }> = []
		for (const multiplier of [1, 2, 4, 8]) {
			let work = 0
			String.prototype.matchAll = function (pattern: RegExp) {
				work += this.length
				return originalMatchAll.call(this, pattern)
			}
			const start = performance.now()
			try {
				const state = new QuotingScanState()
				for (let iteration = 0; iteration < 400 * multiplier; iteration++) {
					state.advance("e.")
					state.advance("g. ")
					expect(state.hasQuotingCue()).toBe(true)
				}
			} finally {
				String.prototype.matchAll = originalMatchAll
			}
			results.push({ multiplier, work, milliseconds: Number((performance.now() - start).toFixed(2)) })
		}
		console.log("Quoting ladder:", JSON.stringify(results))
		expect(results[2].work / results[0].work).toBeLessThan(5)
		expect(results[3].work / results[0].work).toBeLessThan(9)
	})

	it.each(["read\uD800file", "get_uuid", "get_user", "queue1234"])(
		"round-trips native declared name %s",
		async (originalName) => {
			const handler = new VsCodeLmHandler({})
			await handler.initializeClient()
			const client = {
				id: "test",
				name: "test",
				vendor: "test",
				family: "test",
				version: "1",
				maxInputTokens: 100000,
				countTokens: async () => 1,
				sendRequest: async (_messages: unknown, options: vscode.LanguageModelChatRequestOptions) => ({
					stream: (async function* () {
						yield new vscode.LanguageModelToolCallPart("native", options.tools![0].name, {})
					})(),
				}),
			}
			handler["client"] = client as unknown as vscode.LanguageModelChat
			try {
				let found = false
				for await (const chunk of handler.createMessage("", [], {
					taskId: "names",
					tools: [{ type: "function", function: { name: originalName } }],
				}))
					if (chunk.type === "tool_call") {
						expect(chunk.name).toBe(originalName)
						found = true
					}
				expect(found).toBe(true)
			} finally {
				handler.dispose()
			}
		},
	)

	it("preserves cue word boundaries across the bounded lookbehind", () => {
		const scan = new QuotingScanState()
		scan.advance("xnever" + " ".repeat(19))
		expect(scan.hasQuotingCue()).toBe(false)
		scan.advance(" ")
		expect(scan.hasQuotingCue()).toBe(false)
	})

	it("preserves the e.g. word boundary when its leading word character leaves the scan tail", () => {
		const scan = new QuotingScanState()
		scan.advance("xe.g." + " ".repeat(20))
		expect(scan.hasQuotingCue()).toBe(false)
		scan.advance(" ")
		expect(scan.hasQuotingCue()).toBe(false)
	})

	it("discards a completed candidate when cancellation finishes the stream normally", async () => {
		const handler = new VsCodeLmHandler({})
		await handler.initializeClient()
		const client = {
			id: "test",
			name: "test",
			vendor: "test",
			family: "test",
			version: "1",
			maxInputTokens: 100000,
			countTokens: async () => 1,
			sendRequest: async () => ({
				stream: (async function* () {
					yield new vscode.LanguageModelTextPart(wrapped("x"))
					handler["currentRequestCancellation"]?.cancel()
				})(),
			}),
		}
		handler["client"] = client as unknown as vscode.LanguageModelChat
		try {
			for await (const chunk of handler.createMessage("", [], {
				taskId: "cancel",
				tools: [{ type: "function", function: { name: "tool", parameters: tools.get("tool") } }],
			}))
				expect(chunk.type).not.toBe("tool_call")
		} finally {
			handler.dispose()
		}
	})

	it("pins marker reservation and the two-character head/tail boundary", () => {
		const text = "A" + "x".repeat(998) + "Z"
		const reservation =
			`\n\n[... ${text.length.toLocaleString("en-US")} characters truncated to fit the model context window ...]\n\n`
				.length
		expect(middleOutTruncate(text, reservation)).toBe(text.slice(0, reservation))
		const result = middleOutTruncate(text, reservation + 2)
		expect(result.startsWith("A")).toBe(true)
		expect(result.endsWith("Z")).toBe(true)
		expect(result.length).toBeLessThanOrEqual(reservation + 2)
	})

	it("measures the 1x/2x/4x/8x parser ladder with a deterministic work ratio", () => {
		const originalSlice = String.prototype.slice
		const results: Array<{ multiplier: number; work: number; milliseconds: number }> = []
		for (const multiplier of [1, 2, 4, 8]) {
			const text = `<function_calls>\n${(invocation("x") + "\n").repeat(400 * multiplier)}</function_calls>`
			let work = 0
			String.prototype.slice = function (start?: number, end?: number) {
				const result = originalSlice.call(this, start, end)
				work += result.length
				return result
			}
			const start = performance.now()
			try {
				for (let iteration = 0; iteration < 10; iteration++) extractLeakedToolCalls(text, tools)
			} finally {
				String.prototype.slice = originalSlice
			}
			results.push({ multiplier, work, milliseconds: Number((performance.now() - start).toFixed(2)) })
		}
		console.log("Parser ladder:", JSON.stringify(results))
		expect(results[2].work / results[0].work).toBeLessThan(6)
		expect(results[3].work / results[0].work).toBeLessThan(10)
	})

	it("measures same-line wrappers without growing-prefix rescans", () => {
		const originalSlice = String.prototype.slice
		const results: Array<{ multiplier: number; work: number; milliseconds: number }> = []
		for (const multiplier of [1, 2, 4, 8]) {
			const text = ("<function_calls>" + invocation("x") + "</function_calls>").repeat(400 * multiplier)
			let work = 0
			String.prototype.slice = function (start?: number, end?: number) {
				const result = originalSlice.call(this, start, end)
				work += result.length
				return result
			}
			const start = performance.now()
			try {
				expect(extractLeakedToolCalls(text, tools).calls).toHaveLength(1)
			} finally {
				String.prototype.slice = originalSlice
			}
			results.push({ multiplier, work, milliseconds: Number((performance.now() - start).toFixed(2)) })
		}
		console.log("Same-line ladder:", JSON.stringify(results))
		expect(results[2].work / results[0].work).toBeLessThan(6)
	})

	it("measures incremental streaming on the 1x/2x/4x/8x ladder", async () => {
		const handler = new VsCodeLmHandler({})
		await handler.initializeClient()
		const client = {
			id: "test",
			name: "test",
			vendor: "test",
			family: "test",
			version: "1",
			maxInputTokens: 100000,
			countTokens: async () => 1,
			sendRequest: vi.fn(),
		}
		handler["client"] = client as unknown as vscode.LanguageModelChat
		const originalSlice = String.prototype.slice
		const results: Array<{ multiplier: number; work: number; milliseconds: number }> = []
		try {
			for (const multiplier of [1, 2, 4, 8]) {
				const parts = [
					"FOR EXAMPLE ",
					"<function_calls>",
					...Array(400 * multiplier).fill(invocation("x") + "\n"),
					"</function_calls>",
				]
				client.sendRequest.mockResolvedValueOnce({
					stream: (async function* () {
						for (const part of parts) yield new vscode.LanguageModelTextPart(part)
					})(),
				})
				let work = 0
				String.prototype.slice = function (start?: number, end?: number) {
					const result = originalSlice.call(this, start, end)
					work += result.length
					return result
				}
				const start = performance.now()
				let calls = 0
				try {
					for await (const chunk of handler.createMessage("", [], {
						taskId: "scaling",
						tools: [{ type: "function", function: { name: "tool", parameters: tools.get("tool") } }],
					}))
						if (chunk.type === "tool_call") calls++
				} finally {
					String.prototype.slice = originalSlice
				}
				expect(calls).toBe(400 * multiplier - 1)
				results.push({ multiplier, work, milliseconds: Number((performance.now() - start).toFixed(2)) })
			}
		} finally {
			handler.dispose()
		}
		console.log("Streaming ladder:", JSON.stringify(results))
		expect(results[2].work / results[0].work).toBeLessThan(6)
	})

	it.each([" stray ", "<parameter broken>x</parameter>", "</parameter>"])(
		"rejects malformed argument markup %s",
		(body) => {
			const text = `<function_calls><invoke name="tool">${body}</invoke></function_calls>`
			expect(extractLeakedToolCalls(text, tools)).toEqual({ calls: [], leftoverText: text })
		},
	)

	it("keeps streaming equivalent across every split in the corpus", async () => {
		const handler = new VsCodeLmHandler({})
		await handler.initializeClient()
		const client = {
			id: "test",
			name: "test",
			vendor: "test",
			family: "test",
			version: "1",
			maxInputTokens: 100000,
			countTokens: async () => 1,
			sendRequest: vi.fn(),
		}
		handler["client"] = client as unknown as vscode.LanguageModelChat
		try {
			for (const text of corpus) {
				const expected = extractLeakedToolCalls(text, tools)
				for (let boundary = 0; boundary <= text.length; boundary++) {
					client.sendRequest.mockResolvedValueOnce({
						stream: (async function* () {
							yield new vscode.LanguageModelTextPart(text.slice(0, boundary))
							yield new vscode.LanguageModelTextPart(text.slice(boundary))
						})(),
					})
					let actualText = ""
					const actualCalls: object[] = []
					for await (const chunk of handler.createMessage("", [], {
						taskId: "compatibility",
						tools: [{ type: "function", function: { name: "tool", parameters: tools.get("tool") } }],
					})) {
						if (chunk.type === "text") actualText += chunk.text
						if (chunk.type === "tool_call")
							actualCalls.push({ name: chunk.name, input: JSON.parse(chunk.arguments) })
					}
					expect({ calls: actualCalls, leftoverText: actualText }).toEqual(expected)
				}
			}
		} finally {
			handler.dispose()
		}
	})

	it("exports a locally recognizable context failure", () => {
		expect(
			checkContextWindowExceededError(
				Object.assign(new Error("request exceeds context window"), { status: 400 }),
			),
		).toBe(true)
	})
})
