// npx vitest run src/api/transform/__tests__/vscode-lm-format.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"

import {
	convertToVsCodeLmMessages,
	convertToAnthropicRole,
	extractTextCountFromMessage,
	sanitizeSurrogates,
} from "../vscode-lm-format"

// Mock crypto using Vitest
vitest.stubGlobal("crypto", {
	randomUUID: () => "test-uuid",
})

// Define types for our mocked classes
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

// Mock vscode namespace
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

	// The real vscode.LanguageModelDataPart carries no discriminator field, only data and mimeType.
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

		const result = convertToVsCodeLmMessages(messages)

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

		const result = convertToVsCodeLmMessages(messages)

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

		const result = convertToVsCodeLmMessages(messages)

		expect(result).toHaveLength(1)
		expect(result[0].role).toBe("assistant")
		expect(result[0].content).toHaveLength(2)
		// Text must come before tool calls so that tool calls are at the end,
		// properly followed by user message with tool results
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

		const result = convertToVsCodeLmMessages(messages)

		expect(result).toHaveLength(1)
		const imagePart = result[0].content[1] as unknown as MockLanguageModelDataPart
		expect(imagePart.mimeType).toBe("image/png")
		// Guards against passing the base64 string through instead of the decoded bytes.
		expect(Array.from(imagePart.data)).toEqual(Array.from(pngBytes))
	})

	it("should keep a text placeholder for URL-sourced images", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Look at this:" },
					// The SDK's ImageBlockParam.Source only models base64 sources, but URL-sourced
					// images do reach this transform at runtime, so exercise that branch directly.
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

		const result = convertToVsCodeLmMessages(messages)

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
					// Buffer.from strips non-base64 characters rather than throwing, so the data must
					// contain NO base64 alphabet characters at all to actually decode to zero bytes.
					{ type: "image", source: { type: "base64", media_type: "image/png", data: "!!!" } },
				],
			},
		]

		const result = convertToVsCodeLmMessages(messages)

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

		const result = convertToVsCodeLmMessages(messages)

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

		const result = convertToVsCodeLmMessages(messages)

		const toolResult = result[0].content[0] as MockLanguageModelToolResultPart
		expect(toolResult.content[0].value).toBe(`head\uFFFDtail`)
	})

	it("should keep a valid surrogate pair (emoji) intact through conversion", () => {
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: `hi \uD83D\uDE00` }]

		const result = convertToVsCodeLmMessages(messages)

		expect((result[0].content[0] as MockLanguageModelTextPart).value).toBe(`hi \uD83D\uDE00`)
	})
})

describe("sanitizeSurrogates", () => {
	it("leaves plain ASCII unchanged", () => {
		expect(sanitizeSurrogates("hello world")).toBe("hello world")
	})

	it("leaves valid surrogate pairs unchanged", () => {
		// 😀 U+1F600 and 𐀀 U+10000 are astral-plane code points encoded as surrogate pairs.
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
