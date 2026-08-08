import type { Mock } from "vitest"

// Mocks must come first, before imports
vi.mock("vscode", () => {
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

	return {
		workspace: {
			onDidChangeConfiguration: vi.fn((_callback) => ({
				dispose: vi.fn(),
			})),
		},
		CancellationTokenSource: vi.fn(() => ({
			token: {
				isCancellationRequested: false,
				onCancellationRequested: vi.fn(),
			},
			cancel: vi.fn(),
			dispose: vi.fn(),
		})),
		CancellationError: class CancellationError extends Error {
			constructor() {
				super("Operation cancelled")
				this.name = "CancellationError"
			}
		},
		LanguageModelChatMessage: {
			Assistant: vi.fn((content) => ({
				role: "assistant",
				content: Array.isArray(content) ? content : [new MockLanguageModelTextPart(content)],
			})),
			User: vi.fn((content) => ({
				role: "user",
				content: Array.isArray(content) ? content : [new MockLanguageModelTextPart(content)],
			})),
		},
		LanguageModelTextPart: MockLanguageModelTextPart,
		LanguageModelToolCallPart: MockLanguageModelToolCallPart,
		lm: {
			selectChatModels: vi.fn(),
		},
	}
})

import * as vscode from "vscode"
import { openAiModelInfoSaneDefaults, vscodeLlmDefaultModelId, vscodeLlmModels } from "@roo-code/types"
import {
	VsCodeLmHandler,
	extractLeakedToolCalls,
	trailingPartialToolMarkerLength,
	middleOutTruncate,
	truncateToolResultsToFitWindow,
} from "../vscode-lm"
import type { ApiHandlerOptions } from "../../../shared/api"
import type { Anthropic } from "@anthropic-ai/sdk"

const mockLanguageModelChat = {
	id: "test-model",
	name: "Test Model",
	vendor: "test-vendor",
	family: "test-family",
	version: "1.0",
	maxInputTokens: 4096,
	sendRequest: vi.fn(),
	countTokens: vi.fn(),
}

describe("VsCodeLmHandler", () => {
	let handler: VsCodeLmHandler
	const defaultOptions: ApiHandlerOptions = {
		vsCodeLmModelSelector: {
			vendor: "test-vendor",
			family: "test-family",
		},
	}

	beforeEach(() => {
		vi.clearAllMocks()
		handler = new VsCodeLmHandler(defaultOptions)
	})

	afterEach(() => {
		handler.dispose()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeDefined()
			expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled()
		})

		it("should handle configuration changes", () => {
			const callback = (vscode.workspace.onDidChangeConfiguration as Mock).mock.calls[0][0]
			callback({ affectsConfiguration: () => true })
			// Should reset client when config changes
			expect(handler["client"]).toBeNull()
		})
	})

	describe("getCondenseContextWindow", () => {
		it("uses the static-table maxInputTokens for a known VS Code LM family", () => {
			const opusHandler = new VsCodeLmHandler({
				vsCodeLmModelSelector: { vendor: "copilot", family: "claude-opus-4.8" },
			})

			// The condense gate must measure usage against the curated static window, not the
			// inflated live Copilot window, so it agrees with the context bar.
			expect(opusHandler.getCondenseContextWindow()).toBe(vscodeLlmModels["claude-opus-4.8"].maxInputTokens)

			opusHandler.dispose()
		})

		it("falls back to the default-row maxInputTokens for an unknown family (catalog drift)", () => {
			// "test-family" isn't a curated row, so the gate resolves the default row rather than
			// trusting the live window, which VS Code inflates for some models.
			handler["client"] = mockLanguageModelChat as unknown as vscode.LanguageModelChat

			expect(handler.getCondenseContextWindow()).toBe(vscodeLlmModels[vscodeLlmDefaultModelId].maxInputTokens)
		})

		it("falls back to the default-row maxInputTokens when no family is resolvable", () => {
			const noFamilyHandler = new VsCodeLmHandler({ vsCodeLmModelSelector: { vendor: "copilot" } })
			noFamilyHandler["client"] = null

			expect(noFamilyHandler.getCondenseContextWindow()).toBe(
				vscodeLlmModels[vscodeLlmDefaultModelId].maxInputTokens,
			)

			noFamilyHandler.dispose()
		})

		it("falls back to the live window when the static row's maxInputTokens is non-positive", () => {
			const family = "claude-opus-4.8"
			const original = vscodeLlmModels[family].maxInputTokens
			try {
				;(vscodeLlmModels[family] as { maxInputTokens: number }).maxInputTokens = 0
				const guardHandler = new VsCodeLmHandler({
					vsCodeLmModelSelector: { vendor: "copilot", family },
				})
				guardHandler["client"] = null

				expect(guardHandler.getCondenseContextWindow()).toBe(guardHandler.getModel().info.contextWindow)

				guardHandler.dispose()
			} finally {
				;(vscodeLlmModels[family] as { maxInputTokens: number }).maxInputTokens = original
			}
		})
	})

	describe("createClient", () => {
		it("should create client with selector", async () => {
			const mockModel = { ...mockLanguageModelChat }
			;(vscode.lm.selectChatModels as Mock).mockResolvedValueOnce([mockModel])

			const client = await handler["createClient"]({
				vendor: "test-vendor",
				family: "test-family",
			})

			expect(client).toBeDefined()
			expect(client.id).toBe("test-model")
			expect(vscode.lm.selectChatModels).toHaveBeenCalledWith({
				vendor: "test-vendor",
				family: "test-family",
			})
		})

		it("should return default client when no models available", async () => {
			;(vscode.lm.selectChatModels as Mock).mockResolvedValueOnce([])

			const client = await handler["createClient"]({})

			expect(client).toBeDefined()
			expect(client.id).toBe("default-lm")
			expect(client.vendor).toBe("vscode")
		})
	})

	describe("createMessage", () => {
		beforeEach(() => {
			const mockModel = { ...mockLanguageModelChat }
			;(vscode.lm.selectChatModels as Mock).mockResolvedValueOnce([mockModel])
			mockLanguageModelChat.countTokens.mockResolvedValue(10)

			// Override the default client with our test client
			handler["client"] = mockLanguageModelChat
		})

		it("should stream text responses", async () => {
			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user" as const,
					content: "Hello",
				},
			]

			const responseText = "Hello! How can I help you?"
			mockLanguageModelChat.sendRequest.mockResolvedValueOnce({
				stream: (async function* () {
					yield new vscode.LanguageModelTextPart(responseText)
					return
				})(),
				text: (async function* () {
					yield responseText
					return
				})(),
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks).toHaveLength(2) // Text chunk + usage chunk
			expect(chunks[0]).toEqual({
				type: "text",
				text: responseText,
			})
			expect(chunks[1]).toMatchObject({
				type: "usage",
				inputTokens: expect.any(Number),
				outputTokens: expect.any(Number),
			})
		})

		it("should emit tool_call chunks when tools are provided", async () => {
			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user" as const,
					content: "Calculate 2+2",
				},
			]

			const toolCallData = {
				name: "calculator",
				arguments: { operation: "add", numbers: [2, 2] },
				callId: "call-1",
			}

			mockLanguageModelChat.sendRequest.mockResolvedValueOnce({
				stream: (async function* () {
					yield new vscode.LanguageModelToolCallPart(
						toolCallData.callId,
						toolCallData.name,
						toolCallData.arguments,
					)
					return
				})(),
				text: (async function* () {
					yield JSON.stringify({ type: "tool_call", ...toolCallData })
					return
				})(),
			})

			const tools = [
				{
					type: "function" as const,
					function: {
						name: "calculator",
						description: "A simple calculator",
						parameters: {
							type: "object",
							properties: {
								operation: { type: "string" },
								numbers: { type: "array", items: { type: "number" } },
							},
						},
					},
				},
			]

			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools,
			})
			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks).toHaveLength(2) // Tool call chunk + usage chunk
			expect(chunks[0]).toEqual({
				type: "tool_call",
				id: toolCallData.callId,
				name: toolCallData.name,
				arguments: JSON.stringify(toolCallData.arguments),
			})
		})

		it("should handle native tool calls when tools are provided", async () => {
			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user" as const,
					content: "Calculate 2+2",
				},
			]

			const toolCallData = {
				name: "calculator",
				arguments: { operation: "add", numbers: [2, 2] },
				callId: "call-1",
			}

			const tools = [
				{
					type: "function" as const,
					function: {
						name: "calculator",
						description: "A simple calculator",
						parameters: {
							type: "object",
							properties: {
								operation: { type: "string" },
								numbers: { type: "array", items: { type: "number" } },
							},
						},
					},
				},
			]

			mockLanguageModelChat.sendRequest.mockResolvedValueOnce({
				stream: (async function* () {
					yield new vscode.LanguageModelToolCallPart(
						toolCallData.callId,
						toolCallData.name,
						toolCallData.arguments,
					)
					return
				})(),
				text: (async function* () {
					yield JSON.stringify({ type: "tool_call", ...toolCallData })
					return
				})(),
			})

			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools,
			})
			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks).toHaveLength(2) // Tool call chunk + usage chunk
			expect(chunks[0]).toEqual({
				type: "tool_call",
				id: toolCallData.callId,
				name: toolCallData.name,
				arguments: JSON.stringify(toolCallData.arguments),
			})
		})

		it("should pass tools to request options when tools are provided", async () => {
			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user" as const,
					content: "Calculate 2+2",
				},
			]

			const tools = [
				{
					type: "function" as const,
					function: {
						name: "calculator",
						description: "A simple calculator",
						parameters: {
							type: "object",
							properties: {
								operation: { type: "string" },
							},
						},
					},
				},
			]

			mockLanguageModelChat.sendRequest.mockResolvedValueOnce({
				stream: (async function* () {
					yield new vscode.LanguageModelTextPart("Result: 4")
					return
				})(),
				text: (async function* () {
					yield "Result: 4"
					return
				})(),
			})

			const stream = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				tools,
			})
			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify sendRequest was called with tools in options
			// Note: normalizeToolSchema adds additionalProperties: false for JSON Schema 2020-12 compliance
			expect(mockLanguageModelChat.sendRequest).toHaveBeenCalledWith(
				expect.any(Array),
				expect.objectContaining({
					tools: [
						{
							name: "calculator",
							description: "A simple calculator",
							inputSchema: {
								type: "object",
								properties: {
									operation: { type: "string" },
								},
								additionalProperties: false,
							},
						},
					],
				}),
				expect.anything(),
			)
		})

		it("should handle errors", async () => {
			const systemPrompt = "You are a helpful assistant"
			const messages: Anthropic.Messages.MessageParam[] = [
				{
					role: "user" as const,
					content: "Hello",
				},
			]

			mockLanguageModelChat.sendRequest.mockRejectedValueOnce(new Error("API Error"))

			await expect(handler.createMessage(systemPrompt, messages).next()).rejects.toThrow("API Error")
		})
	})

	describe("getModel", () => {
		it("should return model info when client exists", async () => {
			const mockModel = { ...mockLanguageModelChat }
			// The handler starts async initialization in the constructor.
			// Make the test deterministic by explicitly (re)initializing here.
			;(vscode.lm.selectChatModels as Mock).mockResolvedValue([mockModel])
			handler["client"] = null
			await handler.initializeClient()

			const model = handler.getModel()
			expect(model.id).toBe("test-model")
			expect(model.info).toBeDefined()
			expect(model.info.contextWindow).toBe(4096)
		})

		it("should return fallback model info when no client exists", () => {
			// Clear the client first
			handler["client"] = null
			const model = handler.getModel()
			expect(model.id).toBe("test-vendor/test-family")
			expect(model.info).toBeDefined()
		})

		it("should return basic model info when client exists", async () => {
			const mockModel = { ...mockLanguageModelChat }
			// The handler starts async initialization in the constructor.
			// Make the test deterministic by explicitly (re)initializing here.
			;(vscode.lm.selectChatModels as Mock).mockResolvedValue([mockModel])
			handler["client"] = null
			await handler.initializeClient()

			const model = handler.getModel()
			expect(model.info).toBeDefined()
			expect(model.info.contextWindow).toBe(4096)
		})

		it("should return fallback model info when no client exists", () => {
			// Clear the client first
			handler["client"] = null
			const model = handler.getModel()
			expect(model.info).toBeDefined()
		})

		it("should use the full advertised maxInputTokens without an upper cap", async () => {
			// The 128K cap was removed per simurg79/Roo-Code#10; contextWindow now reflects the
			// provider-advertised maxInputTokens directly, even when large (~936K).
			const mockModel = { ...mockLanguageModelChat, maxInputTokens: 936000 }
			;(vscode.lm.selectChatModels as Mock).mockResolvedValue([mockModel])
			handler["client"] = null
			await handler.initializeClient()

			const model = handler.getModel()
			expect(model.info.contextWindow).toBe(936000)
		})

		it("should pass through a small maxInputTokens unchanged", async () => {
			const mockModel = { ...mockLanguageModelChat, maxInputTokens: 4096 }
			;(vscode.lm.selectChatModels as Mock).mockResolvedValue([mockModel])
			handler["client"] = null
			await handler.initializeClient()

			const model = handler.getModel()
			expect(model.info.contextWindow).toBe(4096)
		})

		it("should fall back to sane defaults when maxInputTokens is not a number", async () => {
			const mockModel = { ...mockLanguageModelChat, maxInputTokens: undefined as unknown as number }
			;(vscode.lm.selectChatModels as Mock).mockResolvedValue([mockModel])
			handler["client"] = null
			await handler.initializeClient()

			const model = handler.getModel()
			expect(model.info.contextWindow).toBe(openAiModelInfoSaneDefaults.contextWindow)
		})

		it("resolves supportsImages to true for a family the static table marks image-capable", async () => {
			const mockModel = { ...mockLanguageModelChat, family: "claude-sonnet-4.5" }
			;(vscode.lm.selectChatModels as Mock).mockResolvedValue([mockModel])
			handler["client"] = null
			await handler.initializeClient()

			expect(vscodeLlmModels["claude-sonnet-4.5"].supportsImages).toBe(true)
			expect(handler.getModel().info.supportsImages).toBe(true)
		})

		it("resolves supportsImages to false for a family the static table marks image-incapable", async () => {
			const mockModel = { ...mockLanguageModelChat, family: "gpt-4o-mini" }
			;(vscode.lm.selectChatModels as Mock).mockResolvedValue([mockModel])
			handler["client"] = null
			await handler.initializeClient()

			expect(vscodeLlmModels["gpt-4o-mini"].supportsImages).toBe(false)
			expect(handler.getModel().info.supportsImages).toBe(false)
		})

		it("defaults supportsImages to false for a family missing from the static table", async () => {
			const mockModel = { ...mockLanguageModelChat, family: "totally-unknown-family" }
			;(vscode.lm.selectChatModels as Mock).mockResolvedValue([mockModel])
			handler["client"] = null
			await handler.initializeClient()

			expect(handler.getModel().info.supportsImages).toBe(false)
		})
	})

	describe("countTokens", () => {
		beforeEach(() => {
			handler["client"] = mockLanguageModelChat
		})

		it("should count tokens when called outside of an active request", async () => {
			// Ensure no active request cancellation token exists
			handler["currentRequestCancellation"] = null

			mockLanguageModelChat.countTokens.mockResolvedValueOnce(42)

			const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "Hello world" }]
			const result = await handler.countTokens(content)

			expect(result).toBe(42)
			expect(mockLanguageModelChat.countTokens).toHaveBeenCalledWith("Hello world", expect.any(Object))
		})

		it("should count tokens when called during an active request", async () => {
			// Simulate an active request with a cancellation token
			const mockCancellation = {
				token: { isCancellationRequested: false, onCancellationRequested: vi.fn() },
				cancel: vi.fn(),
				dispose: vi.fn(),
			}
			handler["currentRequestCancellation"] = mockCancellation as any

			mockLanguageModelChat.countTokens.mockResolvedValueOnce(50)

			const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "Test content" }]
			const result = await handler.countTokens(content)

			expect(result).toBe(50)
			expect(mockLanguageModelChat.countTokens).toHaveBeenCalledWith("Test content", mockCancellation.token)
		})

		it("should return 0 when no client is available", async () => {
			handler["client"] = null
			handler["currentRequestCancellation"] = null

			const content: Anthropic.Messages.ContentBlockParam[] = [{ type: "text", text: "Hello" }]
			const result = await handler.countTokens(content)

			expect(result).toBe(0)
		})

		it("should handle image blocks with placeholder", async () => {
			handler["currentRequestCancellation"] = null
			mockLanguageModelChat.countTokens.mockResolvedValueOnce(5)

			const content: Anthropic.Messages.ContentBlockParam[] = [
				{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
			]
			const result = await handler.countTokens(content)

			expect(result).toBe(5)
			expect(mockLanguageModelChat.countTokens).toHaveBeenCalledWith("[IMAGE]", expect.any(Object))
		})
	})

	describe("completePrompt", () => {
		it("should complete single prompt", async () => {
			const mockModel = { ...mockLanguageModelChat }
			;(vscode.lm.selectChatModels as Mock).mockResolvedValueOnce([mockModel])

			const responseText = "Completed text"
			mockLanguageModelChat.sendRequest.mockResolvedValueOnce({
				stream: (async function* () {
					yield new vscode.LanguageModelTextPart(responseText)
					return
				})(),
				text: (async function* () {
					yield responseText
					return
				})(),
			})

			// Override the default client with our test client to ensure it uses
			// the mock implementation rather than the default fallback
			handler["client"] = mockLanguageModelChat

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe(responseText)
			expect(mockLanguageModelChat.sendRequest).toHaveBeenCalled()
		})

		it("should handle errors during completion", async () => {
			const mockModel = { ...mockLanguageModelChat }
			;(vscode.lm.selectChatModels as Mock).mockResolvedValueOnce([mockModel])

			mockLanguageModelChat.sendRequest.mockRejectedValueOnce(new Error("Completion failed"))

			// Make sure we're using the mock client
			handler["client"] = mockLanguageModelChat

			const promise = handler.completePrompt("Test prompt")
			await expect(promise).rejects.toThrow("VSCode LM completion error: Completion failed")
		})
	})
})

describe("leaked tool-call recovery", () => {
	// Builders keep the XML fixtures readable while avoiding giant inline string literals.
	const invoke = (name: string, body: string) => `<in${"voke"} name="${name}">${body}</in${"voke"}>`
	const param = (name: string, value: string) => `<param${"eter"} name="${name}">${value}</param${"eter"}>`

	describe("extractLeakedToolCalls", () => {
		it("recovers a known-tool block and strips it from the leftover text", () => {
			const text = `Working on it.\n${invoke("update_todo_list", param("todos", "[x] one\n[ ] two"))}`

			const { calls, leftoverText } = extractLeakedToolCalls(text, new Set(["update_todo_list"]))

			expect(calls).toEqual([{ name: "update_todo_list", input: { todos: "[x] one\n[ ] two" } }])
			expect(leftoverText).toBe("Working on it.\n")
		})

		it("recovers the real-world 'court'-prefixed, unwrapped leak", () => {
			// Copilot/Claude sometimes streams the call as text with a stray leading token and
			// no <function_calls> wrapper — the exact shape observed in the field.
			const text = `court\n${invoke("update_todo_list", param("todos", "[x] done"))}`

			const { calls, leftoverText } = extractLeakedToolCalls(text, new Set(["update_todo_list"]))

			expect(calls).toEqual([{ name: "update_todo_list", input: { todos: "[x] done" } }])
			expect(leftoverText).toBe("court\n")
		})

		it("recovers multiple params and strips function-call wrapper tags", () => {
			const body = param("mode", "code") + param("message", "go")
			const text = `<function_calls>${invoke("new_task", body)}</function_calls>`

			const { calls, leftoverText } = extractLeakedToolCalls(text, new Set(["new_task"]))

			expect(calls).toEqual([{ name: "new_task", input: { mode: "code", message: "go" } }])
			expect(leftoverText).toBe("")
		})

		it("passes through invoke blocks for tools that were not offered", () => {
			const text = invoke("some_other_tool", param("x", "1"))

			const { calls, leftoverText } = extractLeakedToolCalls(text, new Set(["update_todo_list"]))

			expect(calls).toEqual([])
			expect(leftoverText).toBe(text)
		})

		it("returns no calls for ordinary text", () => {
			const { calls, leftoverText } = extractLeakedToolCalls("just a normal reply", new Set(["update_todo_list"]))

			expect(calls).toEqual([])
			expect(leftoverText).toBe("just a normal reply")
		})
	})

	describe("trailingPartialToolMarkerLength", () => {
		it("holds back a split marker prefix at the end of a chunk", () => {
			expect(trailingPartialToolMarkerLength("some text <in")).toBe(3)
		})

		it("returns 0 for plain text and complete tags", () => {
			expect(trailingPartialToolMarkerLength("hello world")).toBe(0)
			expect(trailingPartialToolMarkerLength("a < b")).toBe(0)
			expect(trailingPartialToolMarkerLength("text <function_calls>")).toBe(0)
		})
	})
})

describe("context-window tool_result truncation", () => {
	describe("middleOutTruncate", () => {
		it("returns text unchanged when within the limit", () => {
			expect(middleOutTruncate("hello world", 100)).toBe("hello world")
		})

		it("keeps the head and tail and inserts a truncation marker", () => {
			const text = "A".repeat(500) + "B".repeat(500)
			const result = middleOutTruncate(text, 200)

			expect(result.length).toBeLessThanOrEqual(200)
			expect(result).toContain("characters truncated to fit the model context window")
			expect(result.startsWith("A")).toBe(true)
			expect(result.endsWith("B")).toBe(true)
		})

		it("returns an empty string for a non-positive limit", () => {
			expect(middleOutTruncate("anything", 0)).toBe("")
		})
	})

	describe("truncateToolResultsToFitWindow", () => {
		const toolUseMessage = (id: string): Anthropic.Messages.MessageParam => ({
			role: "assistant",
			content: [
				{ type: "text", text: "Calling a tool." },
				{ type: "tool_use", id, name: "some_tool", input: { a: 1 } },
			],
		})

		const toolResultMessage = (id: string, content: string): Anthropic.Messages.MessageParam => ({
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: id, content },
				{ type: "text", text: "<environment_details>env</environment_details>" },
			],
		})

		const findBlock = (message: Anthropic.Messages.MessageParam, type: string) =>
			(message.content as unknown as Array<{ type: string; [key: string]: unknown }>).find(
				(block) => block.type === type,
			)!

		it("is a no-op when the conversation already fits the budget", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				toolUseMessage("t1"),
				toolResultMessage("t1", "small result"),
			]
			const before = JSON.parse(JSON.stringify(messages))

			truncateToolResultsToFitWindow(messages, 100_000)

			expect(messages).toEqual(before)
		})

		it("shrinks an oversized tool_result so the conversation fits the budget", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				toolUseMessage("t1"),
				toolResultMessage("t1", "X".repeat(50_000)),
			]

			truncateToolResultsToFitWindow(messages, 10_000)

			const toolResult = findBlock(messages[1], "tool_result")
			expect(toolResult.tool_use_id).toBe("t1") // pairing preserved
			expect(String(toolResult.content).length).toBeLessThanOrEqual(10_000)
			expect(String(toolResult.content)).toContain("characters truncated")
		})

		it("truncates the largest tool_result first and leaves small ones intact", () => {
			const small = "small but real result"
			const messages: Anthropic.Messages.MessageParam[] = [
				toolUseMessage("t1"),
				toolResultMessage("t1", "B".repeat(40_000)),
				toolUseMessage("t2"),
				toolResultMessage("t2", small),
			]

			truncateToolResultsToFitWindow(messages, 12_000)

			expect(String(findBlock(messages[1], "tool_result").content)).toContain("characters truncated")
			expect(findBlock(messages[3], "tool_result").content).toBe(small) // untouched
		})

		it("never truncates tool_use blocks, assistant text, or environment details", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				toolUseMessage("t1"),
				toolResultMessage("t1", "X".repeat(50_000)),
			]

			truncateToolResultsToFitWindow(messages, 8_000)

			expect(findBlock(messages[0], "text").text).toBe("Calling a tool.")
			expect(findBlock(messages[0], "tool_use")).toMatchObject({ id: "t1", name: "some_tool" })
			expect(findBlock(messages[1], "text").text).toBe("<environment_details>env</environment_details>")
		})

		it("handles array-form tool_result content and keeps it valid", () => {
			const messages: Anthropic.Messages.MessageParam[] = [
				toolUseMessage("t1"),
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "t1",
							content: [{ type: "text", text: "Y".repeat(40_000) }],
						},
					],
				},
			]

			truncateToolResultsToFitWindow(messages, 8_000)

			const toolResult = findBlock(messages[1], "tool_result")
			expect(toolResult.tool_use_id).toBe("t1")
			expect(Array.isArray(toolResult.content)).toBe(true)
			const parts = toolResult.content as Array<{ type: string; text?: string }>
			expect(parts[0].type).toBe("text")
			expect(String(parts[0].text)).toContain("characters truncated")
		})
	})
})
