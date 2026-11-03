import { Anthropic } from "@anthropic-ai/sdk"
import type { ApiHandler } from "../../../api"
import { convertToVsCodeLmMessages } from "../../../api/transform/vscode-lm-format"
import { summarizeConversation } from "../index"
import * as vscode from "vscode"

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
	return {
		LanguageModelTextPart,
		LanguageModelDataPart,
		LanguageModelChatMessage: {
			User: (content: unknown) => ({
				role: "user",
				content: Array.isArray(content) ? content : [new LanguageModelTextPart(String(content))],
			}),
			Assistant: (content: unknown) => ({
				role: "assistant",
				content: Array.isArray(content) ? content : [new LanguageModelTextPart(String(content))],
			}),
		},
	}
})

describe("condensation image capabilities", () => {
	it.each([true, undefined, false])("II-05 resolves support %s before the real filter", async (reportedSupport) => {
		let supportsImages: boolean | undefined
		const resolveModelCapabilities = vi.fn().mockImplementation(async () => {
			await Promise.resolve()
			supportsImages = reportedSupport
		})
		const createMessage = vi.fn().mockImplementation(function* () {
			yield { type: "text", text: "summary" }
		})
		const handler: ApiHandler = {
			resolveModelCapabilities,
			getModel: () => ({
				id: "image-model",
				info: { contextWindow: 128000, supportsImages, supportsPromptCache: false },
			}),
			countTokens: vi.fn().mockResolvedValue(1),
			createMessage,
		}
		const image: Anthropic.Messages.ImageBlockParam = {
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "AQID" },
		}
		const messages = [
			{
				role: "user" as const,
				content: [{ type: "text" as const, text: "before" }, image, { type: "text" as const, text: "after" }],
			},
			{ role: "assistant" as const, content: "reply" },
		]
		const originalMessages = structuredClone(messages)
		const result = await summarizeConversation({
			messages,
			apiHandler: handler,
			systemPrompt: "system",
			taskId: "images",
			isAutomaticTrigger: true,
		})
		expect(result.error).toBeUndefined()
		expect(resolveModelCapabilities).toHaveBeenCalledOnce()
		expect(createMessage).toHaveBeenCalledOnce()
		const requestMessages = createMessage.mock.calls[0][1] as Anthropic.Messages.MessageParam[]
		const converted = convertToVsCodeLmMessages(requestMessages, { supportsImages: supportsImages === true })
		const parts = converted.flatMap((message) => message.content)
		const images = parts.filter((part) => part instanceof vscode.LanguageModelDataPart)
		expect(images).toHaveLength(reportedSupport === true ? 1 : 0)
		if (reportedSupport) expect(images[0]).toMatchObject({ mimeType: "image/png", data: new Uint8Array([1, 2, 3]) })
		const text = parts
			.filter((part) => part instanceof vscode.LanguageModelTextPart)
			.map((part) => (part as vscode.LanguageModelTextPart).value)
			.join("\n")
		expect(text).toContain("before")
		expect(text).toContain("after")
		if (!reportedSupport) expect(text).toContain("[Referenced image in conversation]")
		expect(messages).toEqual(originalMessages)
	})
})
