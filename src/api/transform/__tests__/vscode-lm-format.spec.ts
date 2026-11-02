import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"

import {
	convertToVsCodeLmMessages,
	convertToAnthropicRole,
	extractTextCountFromMessage,
	sanitizeSurrogates,
	sanitizeIdentifierSurrogates,
	sanitizeSurrogatesDeep,
	sanitizeToolNameSurrogates,
	decodeToolNameSurrogates,
} from "../vscode-lm-format"

vitest.stubGlobal("crypto", {
	randomUUID: () => "test-uuid",
})

interface MockLanguageModelTextPart {
	type: "text"
	value: string
}

interface MockLanguageModelToolCallPart {
	type: "tool_call"
	callId: string
	name: string
	input: any
}

interface MockLanguageModelToolResultPart {
	type: "tool_result"
	callId: string
	content: MockLanguageModelTextPart[]
}

interface MockLanguageModelDataPart {
	data: Uint8Array
	mimeType: string
}

vitest.mock("vscode", () => {
	const LanguageModelChatMessageRole = {
		Assistant: "assistant",
		User: "user",
	}

	class MockLanguageModelTextPart {
		type = "text"
		constructor(public value: string) {}
	}

	class MockLanguageModelToolCallPart {
		type = "tool_call"
		constructor(
			public callId: string,
			public name: string,
			public input: any,
		) {}
	}

	class MockLanguageModelDataPart {
		constructor(
			public data: Uint8Array,
			public mimeType: string,
		) {}

		static image(data: Uint8Array, mimeType: string) {
			return new MockLanguageModelDataPart(data, mimeType)
		}
	}

	class MockLanguageModelToolResultPart {
		type = "tool_result"
		constructor(
			public callId: string,
			public content: MockLanguageModelTextPart[],
		) {}
	}

	return {
		LanguageModelChatMessage: {
			Assistant: vitest.fn((content) => ({
				role: LanguageModelChatMessageRole.Assistant,
				name: "assistant",
				content: Array.isArray(content) ? content : [new MockLanguageModelTextPart(content)],
			})),
			User: vitest.fn((content) => ({
				role: LanguageModelChatMessageRole.User,
				name: "user",
				content: Array.isArray(content) ? content : [new MockLanguageModelTextPart(content)],
			})),
		},
		LanguageModelChatMessageRole,
		LanguageModelTextPart: MockLanguageModelTextPart,
		LanguageModelDataPart: MockLanguageModelDataPart,
		LanguageModelToolCallPart: MockLanguageModelToolCallPart,
		LanguageModelToolResultPart: MockLanguageModelToolResultPart,
	}
})

describe("convertToVsCodeLmMessages", () => {
	it("should convert simple string messages", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there" },
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })

		expect(result).toHaveLength(2)
		expect(result[0].role).toBe("user")
		expect((result[0].content[0] as MockLanguageModelTextPart).value).toBe("Hello")
		expect(result[1].role).toBe("assistant")
		expect((result[1].content[0] as MockLanguageModelTextPart).value).toBe("Hi there")
	})

	it("should handle complex user messages with tool results", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Here is the result:" },
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: "Tool output",
					},
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })

		expect(result).toHaveLength(1)
		expect(result[0].role).toBe("user")
		expect(result[0].content).toHaveLength(2)
		const [toolResult, textContent] = result[0].content as [
			MockLanguageModelToolResultPart,
			MockLanguageModelTextPart,
		]
		expect(toolResult.type).toBe("tool_result")
		expect(textContent.type).toBe("text")
	})

	it("should handle complex assistant messages with tool calls", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Let me help you with that." },
					{
						type: "tool_use",
						id: "tool-1",
						name: "calculator",
						input: { operation: "add", numbers: [2, 2] },
					},
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })

		expect(result).toHaveLength(1)
		expect(result[0].role).toBe("assistant")
		expect(result[0].content).toHaveLength(2)

		const [textContent, toolCall] = result[0].content as [MockLanguageModelTextPart, MockLanguageModelToolCallPart]
		expect(textContent.type).toBe("text")
		expect(toolCall.type).toBe("tool_call")
	})

	it("should convert base64 image blocks into data parts with decoded bytes", () => {
		const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Look at this:" },
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: Buffer.from(pngBytes).toString("base64"),
						},
					},
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })

		expect(result).toHaveLength(1)
		const imagePart = result[0].content[1] as unknown as MockLanguageModelDataPart
		expect(imagePart.mimeType).toBe("image/png")

		expect(Array.from(imagePart.data)).toEqual(Array.from(pngBytes))
	})

	it("should keep a text placeholder for URL-sourced images", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Look at this:" },

					{
						type: "image",
						source: {
							type: "url",
							url: "https://example.com/image.png",
						},
					} as unknown as Anthropic.ImageBlockParam,
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })

		expect(result).toHaveLength(1)
		const imagePlaceholder = result[0].content[1] as MockLanguageModelTextPart
		expect(imagePlaceholder.value).toBe("[Image (url): unknown media-type not supported by VSCode LM API]")
	})

	it("should fall back to a text placeholder when base64 data decodes to no bytes", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Look at this:" },

					{ type: "image", source: { type: "base64", media_type: "image/png", data: "!!!" } },
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })

		const imagePlaceholder = result[0].content[1] as MockLanguageModelTextPart
		expect(imagePlaceholder.value).toBe("[Image (base64): image/png not supported by VSCode LM API]")
	})

	it("should fall back to a text placeholder for an unsupported media type", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Look at this:" },
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/bmp",
							data: Buffer.from([1, 2, 3]).toString("base64"),
						},
					} as unknown as Anthropic.ImageBlockParam,
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })

		const imagePlaceholder = result[0].content[1] as MockLanguageModelTextPart
		expect(imagePlaceholder.value).toBe("[Image (base64): image/bmp not supported by VSCode LM API]")
	})

	it("should replace an unpaired surrogate in a tool_result with U+FFFD", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool-1",
						content: `head\uD800tail`,
					},
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })

		const toolResult = result[0].content[0] as MockLanguageModelToolResultPart
		expect(toolResult.content[0].value).toBe(`head\uFFFDtail`)
	})

	it("should keep a valid surrogate pair (emoji) intact through conversion", () => {
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: `hi \uD83D\uDE00` }]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })

		expect((result[0].content[0] as MockLanguageModelTextPart).value).toBe(`hi \uD83D\uDE00`)
	})
})

describe("sanitizeSurrogates", () => {
	it("leaves plain ASCII unchanged", () => {
		expect(sanitizeSurrogates("hello world")).toBe("hello world")
	})

	it("leaves valid surrogate pairs unchanged", () => {
		expect(sanitizeSurrogates("a\uD83D\uDE00b\uD800\uDC00c")).toBe("a\uD83D\uDE00b\uD800\uDC00c")
	})

	it("replaces a lone high surrogate with U+FFFD", () => {
		expect(sanitizeSurrogates("a\uD800b")).toBe("a\uFFFDb")
	})

	it("replaces a lone low surrogate with U+FFFD", () => {
		expect(sanitizeSurrogates("a\uDC00b")).toBe("a\uFFFDb")
	})

	it("replaces a trailing lone high surrogate", () => {
		expect(sanitizeSurrogates("abc\uD800")).toBe("abc\uFFFD")
	})

	it("replaces a reversed (low-then-high) pair as two lone surrogates", () => {
		expect(sanitizeSurrogates("\uDC00\uD800")).toBe("\uFFFD\uFFFD")
	})

	it("returns empty and non-surrogate input unchanged", () => {
		expect(sanitizeSurrogates("")).toBe("")
	})
})

describe("convertToAnthropicRole", () => {
	it("should convert assistant role correctly", () => {
		const result = convertToAnthropicRole("assistant" as any)
		expect(result).toBe("assistant")
	})

	it("should convert user role correctly", () => {
		const result = convertToAnthropicRole("user" as any)
		expect(result).toBe("user")
	})

	it("should return null for unknown roles", () => {
		const result = convertToAnthropicRole("unknown" as any)
		expect(result).toBeNull()
	})
})

describe("extractTextCountFromMessage", () => {
	it("should extract text from simple string content", () => {
		const message = {
			role: "user",
			content: "Hello world",
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe("Hello world")
	})

	it("should extract text from LanguageModelTextPart", () => {
		const mockTextPart = new (vitest.mocked(vscode).LanguageModelTextPart)("Text content")
		const message = {
			role: "user",
			content: [mockTextPart],
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe("Text content")
	})

	it("should extract text from multiple LanguageModelTextParts", () => {
		const mockTextPart1 = new (vitest.mocked(vscode).LanguageModelTextPart)("First part")
		const mockTextPart2 = new (vitest.mocked(vscode).LanguageModelTextPart)("Second part")
		const message = {
			role: "user",
			content: [mockTextPart1, mockTextPart2],
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe("First partSecond part")
	})

	it("should extract text from LanguageModelToolResultPart", () => {
		const mockTextPart = new (vitest.mocked(vscode).LanguageModelTextPart)("Tool result content")
		const mockToolResultPart = new (vitest.mocked(vscode).LanguageModelToolResultPart)("tool-result-id", [
			mockTextPart,
		])
		const message = {
			role: "user",
			content: [mockToolResultPart],
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe("tool-result-idTool result content")
	})

	it("should extract text from LanguageModelToolCallPart without input", () => {
		const mockToolCallPart = new (vitest.mocked(vscode).LanguageModelToolCallPart)("call-id", "tool-name", {})
		const message = {
			role: "assistant",
			content: [mockToolCallPart],
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe("tool-namecall-id")
	})

	it("should extract text from LanguageModelToolCallPart with input", () => {
		const mockInput = { operation: "add", numbers: [1, 2, 3] }
		const mockToolCallPart = new (vitest.mocked(vscode).LanguageModelToolCallPart)(
			"call-id",
			"calculator",
			mockInput,
		)
		const message = {
			role: "assistant",
			content: [mockToolCallPart],
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe(`calculatorcall-id${JSON.stringify(mockInput)}`)
	})

	it("should extract text from LanguageModelToolCallPart with empty input", () => {
		const mockToolCallPart = new (vitest.mocked(vscode).LanguageModelToolCallPart)("call-id", "tool-name", {})
		const message = {
			role: "assistant",
			content: [mockToolCallPart],
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe("tool-namecall-id")
	})

	it("should extract text from mixed content types", () => {
		const mockTextPart = new (vitest.mocked(vscode).LanguageModelTextPart)("Text content")
		const mockToolResultTextPart = new (vitest.mocked(vscode).LanguageModelTextPart)("Tool result")
		const mockToolResultPart = new (vitest.mocked(vscode).LanguageModelToolResultPart)("result-id", [
			mockToolResultTextPart,
		])
		const mockInput = { param: "value" }
		const mockToolCallPart = new (vitest.mocked(vscode).LanguageModelToolCallPart)("call-id", "tool", mockInput)

		const message = {
			role: "assistant",
			content: [mockTextPart, mockToolResultPart, mockToolCallPart],
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe(`Text contentresult-idTool resulttoolcall-id${JSON.stringify(mockInput)}`)
	})

	it("should handle empty array content", () => {
		const message = {
			role: "user",
			content: [],
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe("")
	})

	it("should handle undefined content", () => {
		const message = {
			role: "user",
			content: undefined,
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe("")
	})

	it("should handle ToolResultPart with multiple text parts", () => {
		const mockTextPart1 = new (vitest.mocked(vscode).LanguageModelTextPart)("Part 1")
		const mockTextPart2 = new (vitest.mocked(vscode).LanguageModelTextPart)("Part 2")
		const mockToolResultPart = new (vitest.mocked(vscode).LanguageModelToolResultPart)("result-id", [
			mockTextPart1,
			mockTextPart2,
		])

		const message = {
			role: "user",
			content: [mockToolResultPart],
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe("result-idPart 1Part 2")
	})

	it("should handle ToolResultPart with empty parts array", () => {
		const mockToolResultPart = new (vitest.mocked(vscode).LanguageModelToolResultPart)("result-id", [])

		const message = {
			role: "user",
			content: [mockToolResultPart],
		} as any

		const result = extractTextCountFromMessage(message)
		expect(result).toBe("result-id")
	})
})

describe("explicit image capability", () => {
	const image = (mediaType = "image/png", data = "AQID"): Anthropic.ImageBlockParam =>
		({
			type: "image",
			source: { type: "base64", media_type: mediaType, data },
		}) as Anthropic.ImageBlockParam
	const convertedPart = (part: Anthropic.ImageBlockParam, toolResult: boolean, enabled?: boolean) => {
		const message = convertToVsCodeLmMessages(
			[
				{
					role: "user",
					content: toolResult ? [{ type: "tool_result", tool_use_id: "call", content: [part] }] : [part],
				},
			],
			{ supportsImages: enabled },
		)[0]
		return toolResult ? (message.content[0] as unknown as { content: unknown[] }).content[0] : message.content[0]
	}

	it.each([false, true])("defaults disabled in tool result=%s", (toolResult) => {
		expect(convertedPart(image(), toolResult)).toBeInstanceOf(vscode.LanguageModelTextPart)
		expect(convertedPart(image(), toolResult, false)).toBeInstanceOf(vscode.LanguageModelTextPart)
	})

	it.each(["image/png", "image/jpeg", "image/gif", "image/webp"])(
		"decodes enabled %s in both locations",
		(mediaType) => {
			for (const toolResult of [false, true]) {
				const part = convertedPart(image(mediaType), toolResult, true) as vscode.LanguageModelDataPart
				expect(Array.from(part.data)).toEqual([1, 2, 3])
				expect(part.mimeType).toBe(mediaType)
			}
		},
	)

	it.each([
		image("image/tiff"),
		image("image/png", "!!!"),
		{ type: "image", source: { type: "url", url: "https://example.com/image.png" } },
	])("keeps unsupported or empty data as explanatory text", (part) => {
		for (const toolResult of [false, true]) {
			expect(convertedPart(part as Anthropic.ImageBlockParam, toolResult, true)).toBeInstanceOf(
				vscode.LanguageModelTextPart,
			)
		}
	})

	it("reports a Roo-branded host upgrade error only when image data is required", () => {
		const factory = vscode.LanguageModelDataPart.image
		try {
			Object.defineProperty(vscode.LanguageModelDataPart, "image", { configurable: true, value: undefined })
			expect(() => convertedPart(image(), false, true)).toThrow(
				"Roo Code: Image input requires a newer version of VS Code",
			)
			expect(() => convertedPart(image(), true, true)).toThrow("newer version of VS Code")
			expect(() => convertedPart(image(), false, false)).not.toThrow()
			expect(() => convertedPart(image("image/tiff"), false, true)).not.toThrow()
		} finally {
			Object.defineProperty(vscode.LanguageModelDataPart, "image", { configurable: true, value: factory })
		}
	})
})

describe("convertToVsCodeLmMessages surrogate sanitization", () => {
	const lone = "bad\uD800end"
	const sanitized = "bad\uFFFDend"

	const textValues = (message: { content: unknown }) =>
		(message.content as MockLanguageModelTextPart[]).map((part) => part.value)

	it("sanitizes a simple string message", () => {
		const result = convertToVsCodeLmMessages([{ role: "user", content: lone }])
		expect(textValues(result[0])).toEqual([sanitized])
	})

	it("sanitizes string tool_result content", () => {
		const result = convertToVsCodeLmMessages([
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: lone }] },
		])
		const toolResult = result[0].content[0] as MockLanguageModelToolResultPart
		expect(toolResult.content[0].value).toBe(sanitized)
	})

	it("sanitizes tool_result text blocks", () => {
		const result = convertToVsCodeLmMessages([
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-1", content: [{ type: "text", text: lone }] }],
			},
		])
		const toolResult = result[0].content[0] as MockLanguageModelToolResultPart
		expect(toolResult.content[0].value).toBe(sanitized)
	})

	it("sanitizes user text blocks", () => {
		const result = convertToVsCodeLmMessages([{ role: "user", content: [{ type: "text", text: lone }] }])
		expect(textValues(result[0])).toContain(sanitized)
	})

	it("keeps encoded-looking identities paired while argument keys collapse", () => {
		const identifiers = ["call\uD800", "call\uFFFDD800"]
		const converted = convertToVsCodeLmMessages([
			{
				role: "assistant",
				content: identifiers.map((id) => ({
					type: "tool_use" as const,
					id,
					name: "tool",
					input: { ["key\uD800"]: 1, ["key\uD801"]: 2 },
				})),
			},
			{
				role: "user",
				content: identifiers.map((id) => ({
					type: "tool_result" as const,
					tool_use_id: id,
					content: "ok",
				})),
			},
		])
		const calls = converted[0].content as MockLanguageModelToolCallPart[]
		const results = converted[1].content as MockLanguageModelToolResultPart[]
		expect(calls[0].callId).not.toBe(calls[1].callId)
		for (const [index, call] of calls.entries()) {
			expect(call.callId).toBe(results[index].callId)
			expect(call.input).toEqual({ ["key\uFFFD"]: 2 })
		}
	})

	it("sanitizes strings nested in tool_use input", () => {
		const result = convertToVsCodeLmMessages([
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-1",
						name: "read_file",
						input: { path: lone, nested: { list: [lone] } },
					},
				],
			},
		])
		const toolCall = result[0].content[0] as MockLanguageModelToolCallPart
		expect(toolCall.input).toEqual({ path: sanitized, nested: { list: [sanitized] } })
	})

	it("sanitizes assistant text blocks", () => {
		const result = convertToVsCodeLmMessages([{ role: "assistant", content: [{ type: "text", text: lone }] }])
		expect(textValues(result[0])).toContain(sanitized)
	})
})

describe("convertToVsCodeLmMessages surrogate-safe identifiers", () => {
	const LONE_HIGH = String.fromCharCode(0xd800)
	const LONE_LOW = String.fromCharCode(0xdc00)

	const VALID_PAIR = String.fromCharCode(0xd83d, 0xde00)

	const codeUnits = (value: string): number[] =>
		Array.from({ length: value.length }, (_, index) => value.charCodeAt(index))

	const expectNoLoneSurrogate = (value: string) => {
		const surrogates = codeUnits(value).filter((unit) => unit >= 0xd800 && unit <= 0xdfff)
		expect(surrogates).toEqual([])
	}

	it("sanitizes lone surrogates in tool_use id and name", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: `call${LONE_HIGH}1`,
						name: `tool${LONE_LOW}x`,
						input: { key: "value" },
					},
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })
		const toolCall = (result[0].content as unknown as MockLanguageModelToolCallPart[])[0]

		expect(toolCall.callId).toBe("call\uFFFDD8001")

		expect(toolCall.name).toBe("tool_uDC00x")
		expect(codeUnits(toolCall.callId)).toContain(0xfffd)
		expect(toolCall.name).toMatch(/^[\w-]+$/)
		expectNoLoneSurrogate(toolCall.callId)
		expectNoLoneSurrogate(toolCall.name)
	})

	it("sanitizes a lone surrogate in tool_result tool_use_id", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: `result${LONE_HIGH}9`,
						content: [{ type: "text", text: "ok" }],
					},
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })
		const toolResult = (result[0].content as unknown as MockLanguageModelToolResultPart[])[0]

		expect(toolResult.callId).toBe("result\uFFFDD8009")
		expect(codeUnits(toolResult.callId)).toContain(0xfffd)
		expectNoLoneSurrogate(toolResult.callId)
	})

	it("keeps a tool call and its result associated after sanitizing", () => {
		const sharedId = `pair${LONE_HIGH}7`
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: sharedId, name: "tool", input: {} }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: sharedId, content: [{ type: "text", text: "ok" }] }],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })
		const callId = (result[0].content as unknown as MockLanguageModelToolCallPart[])[0].callId
		const resultId = (result[1].content as unknown as MockLanguageModelToolResultPart[])[0].callId

		expect(callId).toBe(resultId)
		expectNoLoneSurrogate(callId)
		expect(codeUnits(callId)).toContain(0xfffd)
	})

	it("leaves a valid surrogate pair in an id untouched", () => {
		const pairedId = `call-${VALID_PAIR}-ok`
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: pairedId, name: `tool-${VALID_PAIR}`, input: {} }],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })
		const toolCall = (result[0].content as unknown as MockLanguageModelToolCallPart[])[0]

		expect(codeUnits(toolCall.callId)).toEqual(codeUnits(pairedId))
		expect(codeUnits(toolCall.name)).toEqual(codeUnits(`tool-${VALID_PAIR}`))
		expect(codeUnits(toolCall.callId)).not.toContain(0xfffd)
	})

	it("keeps ids differing only in their lone surrogate distinct", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: `call${LONE_HIGH}`, name: "tool", input: {} },
					{ type: "tool_use", id: `call${String.fromCharCode(0xd801)}`, name: "tool", input: {} },
					{ type: "tool_use", id: `call${LONE_LOW}`, name: "tool", input: {} },
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })
		const calls = result[0].content as unknown as MockLanguageModelToolCallPart[]
		const ids = calls.map((call) => call.callId)

		expect(new Set(ids).size).toBe(3)
		for (const id of ids) {
			expectNoLoneSurrogate(id)
			expect(codeUnits(id)).toContain(0xfffd)
		}
	})

	it("keeps a call and its result paired when both ids carry the same lone surrogate", () => {
		const sharedId = `dup${LONE_LOW}id`
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: sharedId, name: "tool", input: {} }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: sharedId, content: [{ type: "text", text: "ok" }] }],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })
		const callId = (result[0].content as unknown as MockLanguageModelToolCallPart[])[0].callId
		const resultId = (result[1].content as unknown as MockLanguageModelToolResultPart[])[0].callId

		expect(codeUnits(callId)).toEqual(codeUnits(resultId))
		expectNoLoneSurrogate(callId)
		expect(codeUnits(callId)).toContain(0xfffd)
	})

	it("keeps a result id distinct from another result differing only by its lone surrogate", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: `r${LONE_HIGH}`, content: [{ type: "text", text: "a" }] },
					{ type: "tool_result", tool_use_id: `r${LONE_LOW}`, content: [{ type: "text", text: "b" }] },
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })
		const results = result[0].content as unknown as MockLanguageModelToolResultPart[]

		expect(results[0].callId).not.toBe(results[1].callId)
		expectNoLoneSurrogate(results[0].callId)
		expectNoLoneSurrogate(results[1].callId)
	})

	it("leaves a valid surrogate pair in a tool_result id untouched", () => {
		const pairedId = `res-${VALID_PAIR}-ok`
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: pairedId, content: [{ type: "text", text: "ok" }] }],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })
		const toolResult = (result[0].content as unknown as MockLanguageModelToolResultPart[])[0]

		expect(codeUnits(toolResult.callId)).toEqual(codeUnits(pairedId))
		expect(codeUnits(toolResult.callId)).not.toContain(0xfffd)
	})

	it("keeps a lone surrogate id distinct from its literal U+FFFD encoding", () => {
		const loneSurrogateId = `call${LONE_HIGH}`
		const literalMarkerId = `call\uFFFDD800`

		const plainId = `callD800`

		const sanitizedLone = sanitizeIdentifierSurrogates(loneSurrogateId)
		const sanitizedLiteral = sanitizeIdentifierSurrogates(literalMarkerId)
		const sanitizedPlain = sanitizeIdentifierSurrogates(plainId)

		const encoded = [sanitizedLone, sanitizedLiteral, sanitizedPlain].map((value) => codeUnits(value).join(","))
		expect(new Set(encoded).size).toBe(3)
		expectNoLoneSurrogate(sanitizedLone)
		expectNoLoneSurrogate(sanitizedLiteral)
		expect(codeUnits(sanitizeIdentifierSurrogates("toolu_01ABCDEF"))).toEqual(codeUnits("toolu_01ABCDEF"))
		expect(codeUnits(sanitizeIdentifierSurrogates(`call-${VALID_PAIR}`))).toEqual(codeUnits(`call-${VALID_PAIR}`))
	})

	it("encodes tool names within the permitted identifier character set without collisions", () => {
		const encoded = [`read${LONE_HIGH}file`, "read_uD800file", "readD800file", `read${LONE_LOW}file`].map((name) =>
			sanitizeToolNameSurrogates(name),
		)

		for (const name of encoded) {
			expect(name).toMatch(/^[\w-]+$/)
			expectNoLoneSurrogate(name)
		}
		expect(new Set(encoded).size).toBe(encoded.length)
		expect(codeUnits(sanitizeToolNameSurrogates(`read-${VALID_PAIR}`))).toEqual(codeUnits(`read-${VALID_PAIR}`))
	})

	it("leaves a valid tool name untouched so it still matches its registry entry", () => {
		for (const name of ["get_user", "read_file", "apply_diff", "update_todo_list"]) {
			expect(sanitizeToolNameSurrogates(name)).toBe(name)
			expect(decodeToolNameSurrogates(sanitizeToolNameSurrogates(name))).toBe(name)
		}
	})

	it("round-trips encoded tool names back to the original registry name", () => {
		for (const name of [`read${LONE_HIGH}file`, `read${LONE_LOW}file`, "a_uu_b", "x_uD800y", "get_user"]) {
			const declared = sanitizeToolNameSurrogates(name)
			expect(declared).toMatch(/^[\w-]+$/)
			expect(codeUnits(decodeToolNameSurrogates(declared))).toEqual(codeUnits(name))
		}
	})

	it("does not decode a non-marker u+hex sequence", () => {
		const name = "queue1234"
		expect(sanitizeToolNameSurrogates(name)).toBe(name)
		expect(codeUnits(decodeToolNameSurrogates(name))).toEqual(codeUnits(name))
	})

	it("replays a tool call in history under the same name it was declared with", () => {
		const originalName = `read${LONE_HIGH}file`
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "toolu_1", name: originalName, input: {} }],
			},
		]

		const toolCall = (
			convertToVsCodeLmMessages(messages, { supportsImages: true })[0]
				.content as unknown as MockLanguageModelToolCallPart[]
		)[0]

		expect(toolCall.name).toBe(sanitizeToolNameSurrogates(originalName))
		expect(toolCall.name).toMatch(/^[\w-]+$/)
		expect(decodeToolNameSurrogates(toolCall.name)).toBe(originalName)
	})

	it("keeps a valid history tool name unchanged", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "toolu_1", name: "get_user", input: {} }],
			},
		]

		const toolCall = (
			convertToVsCodeLmMessages(messages, { supportsImages: true })[0]
				.content as unknown as MockLanguageModelToolCallPart[]
		)[0]

		expect(toolCall.name).toBe("get_user")
	})

	it("collapses argument keys differing only in their lone surrogate, last value winning", () => {
		const collapsed = sanitizeSurrogatesDeep({ [`a${LONE_HIGH}`]: 1, [`a${LONE_LOW}`]: 2 }) as Record<
			string,
			unknown
		>

		expect(Object.keys(collapsed)).toEqual(["a\uFFFD"])
		expect(collapsed["a\uFFFD"]).toBe(2)
	})

	it("leaves an id with no surrogates byte-identical", () => {
		const plainId = "toolu_01ABCDEF"
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: plainId, name: "tool", input: {} }],
			},
		]

		const result = convertToVsCodeLmMessages(messages, { supportsImages: true })
		const toolCall = (result[0].content as unknown as MockLanguageModelToolCallPart[])[0]

		expect(toolCall.callId).toBe(plainId)
	})
})
