import type { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import { vscodeLlmModels } from "@roo-code/types"

import { getVsCodeLmModels, VsCodeLmHandler } from "../vscode-lm"
import { getCondenseAllowance } from "../../../core/context-management"
import { condenseAllowanceCases } from "../../../core/context-management/__tests__/condense-allowance-cases"
import {
	CONTEXT_WINDOW_EXCEEDED_STATUS,
	checkContextWindowExceededError,
} from "../../../core/context/context-management/context-error-handling"
import type { ApiHandlerCreateMessageMetadata } from "../../index"

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
		public content: unknown[]
		constructor(
			public role: string,
			content: string | unknown[],
		) {
			this.content = typeof content === "string" ? [new LanguageModelTextPart(content)] : content
		}
		static Assistant(content: string | unknown[]) {
			return new LanguageModelChatMessage("assistant", content)
		}
		static User(content: string | unknown[]) {
			return new LanguageModelChatMessage("user", content)
		}
	}
	return {
		LanguageModelTextPart,
		LanguageModelDataPart,
		LanguageModelToolCallPart,
		LanguageModelToolResultPart,
		LanguageModelChatMessage,
		LanguageModelChatMessageRole: { Assistant: "assistant", User: "user" },
		workspace: { onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })) },
		lm: { selectChatModels: vi.fn().mockResolvedValue([]) },
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

const imageFactory = vscode.LanguageModelDataPart.image
const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const image = (): Anthropic.ImageBlockParam => ({
	type: "image",
	source: { type: "base64", media_type: "image/png", data: Buffer.from(imageBytes).toString("base64") },
})
const imageMessages = (): Anthropic.Messages.MessageParam[] => [
	{ role: "user", content: [{ type: "text", text: "user surrounding text" }, image()] },
	{
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "read-image",
				content: [{ type: "text", text: "tool surrounding text" }, image()],
			},
		],
	},
]
const textMessages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "small request" }]
const handlers: VsCodeLmHandler[] = []

function makeClient(capabilities: Record<string, unknown> = { supportsImageToText: true }) {
	const streamOpened = vi.fn()
	const countTokens = vi.fn(async (_input: string | vscode.LanguageModelChatMessage) => 0)
	const sendRequest = vi.fn(async (_messages: vscode.LanguageModelChatMessage[]) => ({
		stream: (async function* () {
			streamOpened()
			yield new vscode.LanguageModelTextPart("reply")
		})(),
	}))
	return {
		id: "unlisted-model",
		name: "Unlisted model",
		vendor: "other-vendor",
		family: "unlisted-image-family",
		version: "1",
		maxInputTokens: 128000,
		capabilities,
		countTokens,
		sendRequest,
		streamOpened,
	}
}

async function makeHandler(client = makeClient()) {
	vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([client as unknown as vscode.LanguageModelChat])
	const handler = new VsCodeLmHandler({ vsCodeLmModelSelector: { id: client.id, family: client.family } })
	handlers.push(handler)
	// Settle constructor acquisition before a test replaces or clears the retained client.
	await handler.resolveModelCapabilities()
	return handler
}

async function send(
	handler: VsCodeLmHandler,
	messages = textMessages,
	metadata?: Pick<ApiHandlerCreateMessageMetadata, "condenseAllowance">,
) {
	const chunks = []
	for await (const chunk of handler.createMessage("system prompt", messages, { taskId: "image-input", ...metadata }))
		chunks.push(chunk)
	return chunks
}

function setInputCount(client: ReturnType<typeof makeClient>, inputTokens: number) {
	client.countTokens.mockImplementation(async (input) =>
		typeof input === "string" || input.role === vscode.LanguageModelChatMessageRole.Assistant ? 0 : inputTokens,
	)
}

function expectImage(part: unknown) {
	expect(part).toBeInstanceOf(vscode.LanguageModelDataPart)
	const dataPart = part as vscode.LanguageModelDataPart
	expect(dataPart.mimeType).toBe("image/png")
	expect(dataPart.data).toEqual(imageBytes)
}

function expectPlaceholders(messages: vscode.LanguageModelChatMessage[]) {
	const userParts = messages[1].content
	const toolResult = messages[2].content[0] as vscode.LanguageModelToolResultPart
	expect(userParts[1]).toBeInstanceOf(vscode.LanguageModelTextPart)
	expect((userParts[1] as vscode.LanguageModelTextPart).value).toContain("[Image (base64): image/png")
	expect(toolResult).toBeInstanceOf(vscode.LanguageModelToolResultPart)
	expect(toolResult.content[1]).toBeInstanceOf(vscode.LanguageModelTextPart)
	expect((toolResult.content[1] as vscode.LanguageModelTextPart).value).toContain("[Image (base64): image/png")
	for (const part of [...userParts, ...toolResult.content]) {
		expect(part).not.toBeInstanceOf(vscode.LanguageModelDataPart)
		expect(part).not.toHaveProperty("data")
	}
}

async function expectMeasurementFailure(handler: VsCodeLmHandler, client: ReturnType<typeof makeClient>) {
	const error = await send(handler, imageMessages()).catch((failure: unknown) => failure)
	expect(error).toBeInstanceOf(Error)
	expect((error as Error).message).toContain("Roo Code <Language Model API>: Could not measure request size")
	expect(error).not.toHaveProperty("status", CONTEXT_WINDOW_EXCEEDED_STATUS)
	expect(checkContextWindowExceededError(error)).toBe(false)
	expect(client.sendRequest).not.toHaveBeenCalled()
	expect(client.streamOpened).not.toHaveBeenCalled()
	expect(handler["currentRequestCancellation"]).toBeNull()
}

describe("VS Code LM provider image-input contract", () => {
	beforeEach(() => {
		vi.mocked(vscode.lm.selectChatModels).mockReset().mockResolvedValue([])
		vi.spyOn(console, "debug").mockImplementation(() => {})
		vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
	})
	afterEach(() => {
		for (const handler of handlers.splice(0)) handler.dispose()
		vi.restoreAllMocks()
		Object.defineProperty(vscode.LanguageModelDataPart, "image", { configurable: true, value: imageFactory })
	})

	it("II-01 keeps static-positive/live-unknown user and tool images as placeholders without bytes", async () => {
		const client = { ...makeClient({}), family: "claude-sonnet-4.5" }
		const handler = await makeHandler(client)
		expect(vscodeLlmModels["claude-sonnet-4.5"].supportsImages).toBe(true)
		expect(handler.getModel().info.supportsImages).toBeUndefined()
		await send(handler, imageMessages(), { condenseAllowance: -1 })
		expectPlaceholders(client.sendRequest.mock.calls[0][0])
		expect(client.streamOpened).toHaveBeenCalledOnce()
	})

	it("II-04 swallows hook acquisition failure, stays unknown, and recovers for a text request", async () => {
		const client = makeClient({})
		const handler = await makeHandler(client)
		handler["client"] = null
		vi.mocked(vscode.lm.selectChatModels).mockRejectedValue(new Error("discovery unavailable"))
		await expect(handler.resolveModelCapabilities()).resolves.toBeUndefined()
		expect(handler.getModel().info.supportsImages).toBeUndefined()
		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([client as unknown as vscode.LanguageModelChat])
		await send(handler, imageMessages())
		expectPlaceholders(client.sendRequest.mock.calls[0][0])
		await expect(send(handler)).resolves.toContainEqual({ type: "text", text: "reply" })
	})

	it.each(condenseAllowanceCases)("II-06 admits equality and rejects allowance + 1: $name", async ({ options }) => {
		const originalOptions = structuredClone(options)
		const allowance = getCondenseAllowance(options)
		const client = makeClient()
		const handler = await makeHandler(client)
		const originalModel = handler.getModel()
		const originalBudget = handler.getCondenseContextWindow()
		setInputCount(client, allowance)
		const metadata = { condenseAllowance: allowance }
		await expect(send(handler, textMessages, metadata)).resolves.toContainEqual({
			type: "usage",
			inputTokens: allowance,
			outputTokens: 0,
		})
		expect(client.sendRequest).toHaveBeenCalledOnce()
		client.sendRequest.mockClear()
		client.streamOpened.mockClear()
		setInputCount(client, allowance + 1)
		const error = await send(handler, textMessages, metadata).catch((failure: unknown) => failure)
		expect(error).toHaveProperty("status", CONTEXT_WINDOW_EXCEEDED_STATUS)
		expect(checkContextWindowExceededError(error)).toBe(true)
		expect(client.sendRequest).not.toHaveBeenCalled()
		expect(client.streamOpened).not.toHaveBeenCalled()
		expect(handler.getModel()).toEqual(originalModel)
		expect(handler.getCondenseContextWindow()).toBe(originalBudget)
		expect(options).toEqual(originalOptions)
		expect(metadata).toEqual({ condenseAllowance: allowance })
	})

	it.each([undefined, 200000])(
		"II-06 enforces the live allowance with condensation allowance %s",
		async (allowance) => {
			const client = makeClient()
			const handler = await makeHandler(client)
			setInputCount(client, client.maxInputTokens)
			await send(handler, textMessages, { condenseAllowance: allowance })
			expect(client.sendRequest).toHaveBeenCalledOnce()
			client.sendRequest.mockClear()
			setInputCount(client, client.maxInputTokens + 1)
			await expect(send(handler, textMessages, { condenseAllowance: allowance })).rejects.toHaveProperty(
				"status",
				CONTEXT_WINDOW_EXCEEDED_STATUS,
			)
			expect(client.sendRequest).not.toHaveBeenCalled()
		},
	)

	it("I8/I10 measures intact messages including nested tool images and forwards the same messages", async () => {
		const client = makeClient()
		const handler = await makeHandler(client)
		client.countTokens.mockImplementation(async (input) => {
			if (typeof input === "string" || input.role === vscode.LanguageModelChatMessageRole.Assistant) return 0
			expect(input).toBeInstanceOf(vscode.LanguageModelChatMessage)
			return input.content[0] instanceof vscode.LanguageModelToolResultPart ? 7 : 5
		})
		const chunks = await send(handler, imageMessages())
		const sent = client.sendRequest.mock.calls[0][0]
		expect(sent).toHaveLength(3)
		for (const message of sent) expect(client.countTokens).toHaveBeenCalledWith(message, expect.anything())
		expect((sent[1].content[0] as vscode.LanguageModelTextPart).value).toBe("user surrounding text")
		expectImage(sent[1].content[1])
		const toolResult = sent[2].content[0] as vscode.LanguageModelToolResultPart
		expect(toolResult.callId).toBe("read-image")
		expect((toolResult.content[0] as vscode.LanguageModelTextPart).value).toBe("tool surrounding text")
		expectImage(toolResult.content[1])
		expect(chunks).toContainEqual({ type: "usage", inputTokens: 12, outputTokens: 0 })
	})

	it.each(["user", "tool"])(
		"I10 countTokens(content) counts converted %s images rather than extracted text",
		async (kind) => {
			const client = makeClient()
			const handler = await makeHandler(client)
			client.countTokens.mockResolvedValue(17)
			const content = imageMessages()[kind === "user" ? 0 : 1].content as Anthropic.Messages.ContentBlockParam[]
			await expect(handler.countTokens(content)).resolves.toBe(17)
			expect(client.countTokens).toHaveBeenCalledOnce()
			const counted = client.countTokens.mock.calls[0][0] as vscode.LanguageModelChatMessage
			expect(counted).toBeInstanceOf(vscode.LanguageModelChatMessage)
			const parts =
				kind === "tool" ? (counted.content[0] as vscode.LanguageModelToolResultPart).content : counted.content
			expectImage(parts[1])
			expect(client.sendRequest).not.toHaveBeenCalled()
		},
	)

	it.each([
		{ name: "throw", result: new Error("counter failed") },
		{ name: "cancellation error", result: new vscode.CancellationError() },
		{ name: "NaN", result: NaN },
		{ name: "Infinity", result: Infinity },
		{ name: "negative", result: -1 },
		{ name: "non-number", result: "10" },
	])("II-09 rejects strict measurement $name without context status or stream", async ({ result }) => {
		const client = makeClient()
		const handler = await makeHandler(client)
		if (result instanceof Error) client.countTokens.mockRejectedValue(result)
		else client.countTokens.mockResolvedValue(result as number)
		await expectMeasurementFailure(handler, client)
	})

	it("II-09 rejects cancellation even when the counter resolves a valid number", async () => {
		const client = makeClient()
		const handler = await makeHandler(client)
		client.countTokens.mockImplementation(async () => {
			handler["currentRequestCancellation"]?.cancel()
			return 0
		})
		await expectMeasurementFailure(handler, client)
	})

	it("II-09 refuses strict admission when getClient returns a model without retaining it", async () => {
		const client = makeClient()
		const handler = await makeHandler(client)
		const supportedModel = handler.getModel()
		handler["client"] = null
		vi.spyOn(
			handler as unknown as { getClient(): Promise<vscode.LanguageModelChat> },
			"getClient",
		).mockResolvedValue(client as unknown as vscode.LanguageModelChat)
		vi.spyOn(handler, "getModel").mockReturnValue(supportedModel)
		await expectMeasurementFailure(handler, client)
		expect(client.countTokens).not.toHaveBeenCalled()
	})

	it.each([
		{ capabilities: { supportsImageToText: false, imageInput: true }, expected: false },
		{ capabilities: { supportsImageToText: true, imageInput: false }, expected: true },
		{ capabilities: { supportsImageToText: "true", imageInput: false }, expected: false },
		{ capabilities: { supportsImageToText: null, imageInput: true }, expected: true },
		{ capabilities: { imageInput: true }, expected: true },
		{ capabilities: { imageInput: false }, expected: false },
		{ capabilities: { supportsImageToText: 1, imageInput: "true" }, expected: undefined },
		{ capabilities: {}, expected: undefined },
	])("II-10 honors boolean report precedence: $capabilities", async ({ capabilities, expected }) => {
		const client = makeClient(capabilities)
		const handler = await makeHandler(client)
		expect(handler.getModel().info.supportsImages).toBe(expected)
		expect((await getVsCodeLmModels())[0].supportsImages).toBe(expected)
		if (expected === false) {
			await send(handler, imageMessages(), { condenseAllowance: -1 })
			expectPlaceholders(client.sendRequest.mock.calls[0][0])
		}
	})

	it("II-10 stays unknown before selection even on an incapable host, then becomes unsupported", async () => {
		const client = makeClient()
		const handler = await makeHandler(client)
		handler["client"] = null
		Object.defineProperty(vscode.LanguageModelDataPart, "image", { configurable: true, value: undefined })
		expect(handler.getModel().info.supportsImages).toBeUndefined()
		handler["client"] = client as unknown as vscode.LanguageModelChat
		expect(handler.getModel().info.supportsImages).toBe(false)
		expect((await getVsCodeLmModels())[0].supportsImages).toBe(false)
		await send(handler, imageMessages())
		expectPlaceholders(client.sendRequest.mock.calls[0][0])
	})

	it("II-10 discovers every vendor, preserves metadata, excludes existing blacklist, and clears on empty/error", async () => {
		const first = makeClient()
		const second = { ...makeClient({ imageInput: false }), id: "copilot-model", vendor: "copilot" }
		const excluded = ["claude-3.7-sonnet", "claude-3.7-sonnet-thought"].map((id) => ({ ...makeClient(), id }))
		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
			first,
			second,
			...excluded,
		] as unknown as vscode.LanguageModelChat[])
		await expect(getVsCodeLmModels()).resolves.toEqual(
			[first, second].map((client, index) => ({
				id: client.id,
				name: client.name,
				vendor: client.vendor,
				family: client.family,
				version: client.version,
				maxInputTokens: client.maxInputTokens,
				supportsImages: index === 0,
			})),
		)
		expect(vscode.lm.selectChatModels).toHaveBeenCalledWith({})
		vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([])
		await expect(getVsCodeLmModels()).resolves.toEqual([])
		vi.mocked(vscode.lm.selectChatModels).mockRejectedValue(new Error("discovery failed"))
		await expect(getVsCodeLmModels()).resolves.toEqual([])
	})

	it("II-11 sends a URL placeholder and proceeds without a base64-required rejection", async () => {
		const client = makeClient()
		const handler = await makeHandler(client)
		await send(handler, [
			{
				role: "user",
				content: [
					{ type: "text", text: "linked image" },
					{
						type: "image",
						source: { type: "url", url: "https://example.com/image.png" },
					} as unknown as Anthropic.ImageBlockParam,
				],
			},
		])
		const parts = client.sendRequest.mock.calls[0][0][1].content
		expect(parts[1]).toBeInstanceOf(vscode.LanguageModelTextPart)
		expect((parts[1] as vscode.LanguageModelTextPart).value).toContain("[Image (url):")
		expect(parts[1]).not.toHaveProperty("data")
		expect(client.streamOpened).toHaveBeenCalledOnce()
	})

	it.each([8192, 9000])("II-12 allowance -1 rejects zero input with reservation %s", async (maxTokens) => {
		const options = {
			...condenseAllowanceCases[0].options,
			contextWindow: 8192,
			maxTokens,
			useAvailableInputForContextPercent: true,
		}
		const allowance = getCondenseAllowance(options)
		expect(allowance).toBe(-1)
		const client = makeClient()
		const handler = await makeHandler(client)
		setInputCount(client, 0)
		await expect(send(handler, textMessages, { condenseAllowance: allowance })).rejects.toHaveProperty(
			"status",
			CONTEXT_WINDOW_EXCEEDED_STATUS,
		)
		expect(client.sendRequest).not.toHaveBeenCalled()
		expect(client.streamOpened).not.toHaveBeenCalled()
	})

	it("I9 reports a Roo-branded newer-VS-Code conversion error if host support disappears", async () => {
		const client = makeClient()
		const handler = await makeHandler(client)
		const supportedModel = handler.getModel()
		expect(supportedModel.info.supportsImages).toBe(true)
		vi.spyOn(handler, "getModel").mockReturnValue(supportedModel)
		Object.defineProperty(vscode.LanguageModelDataPart, "image", { configurable: true, value: undefined })
		await expect(send(handler, imageMessages())).rejects.toThrow(
			"Roo Code: Image input requires a newer version of VS Code",
		)
		expect(client.sendRequest).not.toHaveBeenCalled()
		expect(client.streamOpened).not.toHaveBeenCalled()
	})
})
