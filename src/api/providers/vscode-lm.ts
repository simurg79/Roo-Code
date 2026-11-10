import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import OpenAI from "openai"

import { type ModelInfo, openAiModelInfoSaneDefaults, vscodeLlmDefaultModelId, vscodeLlmModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { SELECTOR_SEPARATOR, stringifyVsCodeLmModelSelector } from "../../shared/vsCodeSelectorUtils"
import { normalizeToolSchema } from "../../utils/json-schema"

import { ApiStream, ApiStreamChunk } from "../transform/stream"
import {
	canCreateImageParts,
	convertToVsCodeLmMessages,
	extractTextCountFromMessage,
	sanitizeSurrogates,
	sanitizeSurrogatesDeep,
	sanitizeToolNameSurrogates,
} from "../transform/vscode-lm-format"

import { CONTEXT_WINDOW_EXCEEDED_STATUS } from "../../core/context/context-management/context-error-handling"

import { QuotingScanState } from "./vscode-lm-quoting"
import { reportedImageSupport } from "./vscode-lm-capabilities"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

/**
 * Converts OpenAI-format tools to VSCode Language Model tools.
 * Normalizes the JSON Schema to draft 2020-12 compliant format required by
 * GitHub Copilot's backend, converting type: ["T", "null"] to anyOf format.
 * @param tools Array of OpenAI ChatCompletionTool definitions
 * @returns Array of VSCode LanguageModelChatTool definitions
 */
function convertToVsCodeLmTools(tools: OpenAI.Chat.ChatCompletionTool[]): vscode.LanguageModelChatTool[] {
	return tools
		.filter((tool) => tool.type === "function")
		.map((tool) => ({
			name: sanitizeToolNameSurrogates(tool.function.name),
			description: sanitizeSurrogates(tool.function.description || ""),
			inputSchema: tool.function.parameters
				? (sanitizeSurrogatesDeep(
						normalizeToolSchema(tool.function.parameters as Record<string, unknown>),
					) as object)
				: undefined,
		}))
}

const LEAKED_TOOL_CALL_START = /<\/?(?:antml:)?function_calls(?:\s|>)|<(?:antml:)?invoke\s+name="/i
let salvageRequestIndex = 0

const MAX_PARTIAL_INVOKE_CARRY = 64

export function trailingPartialToolMarkerLength(text: string): number {
	const tailStart = text.lastIndexOf("<")
	const tail = text.slice(tailStart).toLowerCase()
	if (
		tailStart !== -1 &&
		[
			"<function_calls",
			"</function_calls",
			"<antml:function_calls",
			"</antml:function_calls",
			"<invoke",
			"<antml:invoke",
		].some((marker) => marker.startsWith(tail))
	) {
		return tail.length
	}

	if (/<(?:antml:)?invoke\s+(?:n(?:a(?:m(?:e(?:=)?)?)?)?)?$/i.test(text)) {
		return text.length - tailStart
	}
	const partialTag = text.match(/<(?:antml:)?[a-zA-Z_]*$/)
	if (partialTag) {
		return partialTag[0].length <= MAX_PARTIAL_INVOKE_CARRY ? partialTag[0].length : 0
	}

	const partialInvoke = text.match(/<(?:antml:)?invoke\b[^<>]*$/i)
	return partialInvoke && partialInvoke[0].length <= MAX_PARTIAL_INVOKE_CARRY ? partialInvoke[0].length : 0
}

function narrationSuffixes(text: string): Uint8Array {
	const matchingOpeners = new Map<number, number>()
	const pendingOpeners: number[] = []
	for (let index = 0; index < text.length; index++) {
		if (text[index] === "\n") pendingOpeners.length = 0
		else if (text[index] === "<") pendingOpeners.push(index)
		else if (text[index] === ">" && pendingOpeners.length) matchingOpeners.set(index, pendingOpeners.pop()!)
	}
	const suffixes = new Uint8Array(text.length + 1)
	let skippedUntil = text.length
	let hasNarration = false
	for (let index = text.length - 1; index >= 0; index--) {
		if (text[index] === "\n") {
			hasNarration = false
			skippedUntil = index
		} else if (index < skippedUntil) {
			const opener = matchingOpeners.get(index)
			if (opener !== undefined) skippedUntil = opener
			else if (text[index].trim()) hasNarration = true
		}
		suffixes[index] = Number(hasNarration)
	}
	return suffixes
}

function isQuotedAsCode(suffixes: Uint8Array, endIndex: number, scan: QuotingScanState): boolean {
	if (scan.isInsideCodeFence() || scan.hasOddBacktickCountOnLine()) {
		return true
	}

	if (suffixes[endIndex]) {
		return true
	}

	return scan.hasQuotingCue()
}

export type LeakedToolSchemas = ReadonlyMap<string, Record<string, unknown> | undefined>

function structuredParamCheck(declaredType: string): ((parsed: unknown) => boolean) | undefined {
	const checks: Record<string, (parsed: unknown) => boolean> = {
		object: (parsed) => typeof parsed === "object" && !Array.isArray(parsed),
		array: (parsed) => Array.isArray(parsed),
		number: (parsed) => Number.isFinite(parsed),
		integer: (parsed) => Number.isInteger(parsed),
		boolean: (parsed) => typeof parsed === "boolean",
	}

	return Object.hasOwn(checks, declaredType) ? checks[declaredType] : undefined
}

type DeclaredType = { type: string; nullable: boolean }

function resolveTypeUnion(types: string[]): DeclaredType | undefined {
	const nullable = types.includes("null")
	const nonNullTypes = types.filter((entry) => entry !== "null")

	if (nonNullTypes.length === 0) {
		return nullable ? { type: "null", nullable } : undefined
	}

	return nonNullTypes.length === 1 ? { type: nonNullTypes[0], nullable } : undefined
}

function declaredParamType(schema: Record<string, unknown> | undefined, paramName: string): DeclaredType | undefined {
	const properties = schema?.["properties"] as Record<string, unknown> | undefined
	const property = properties?.[paramName] as Record<string, unknown> | undefined
	const type = property?.["type"]
	if (typeof type === "string") {
		return { type, nullable: false }
	}
	if (Array.isArray(type)) {
		return resolveTypeUnion(type.filter((entry): entry is string => typeof entry === "string"))
	}
	const alternatives = property?.["anyOf"]
	if (Array.isArray(alternatives)) {
		const branchTypes: string[] = []
		for (const alternative of alternatives) {
			const branchType = (alternative as Record<string, unknown> | null)?.["type"]

			if (typeof branchType !== "string") {
				return undefined
			}
			branchTypes.push(branchType)
		}
		return resolveTypeUnion(branchTypes)
	}
	return undefined
}

function convertLeakedParamValue(raw: string, declared: DeclaredType | undefined): { value: unknown } | undefined {
	if (declared === undefined || declared.type === "string") {
		return { value: raw }
	}

	if (declared.type === "null") {
		return raw === "null" ? { value: null } : undefined
	}
	const matchesDeclaredType = structuredParamCheck(declared.type)
	if (!matchesDeclaredType) {
		return undefined
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return undefined
	}

	if (parsed === null) {
		return declared.nullable ? { value: null } : undefined
	}

	return matchesDeclaredType(parsed) ? { value: parsed } : undefined
}

function parseLeakedInvokeParams(
	body: string,
	schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const input: Record<string, unknown> = Object.create(null)
	const openerPattern = /<(?:antml:)?parameter\s+name="([^"]+)"\s*>/gi
	const closerPattern = /<\/(?:antml:)?parameter\s*>/gi
	let consumedUpTo = 0
	for (let opener = openerPattern.exec(body); opener; opener = openerPattern.exec(body)) {
		if (body.slice(consumedUpTo, opener.index).trim()) return undefined
		const valueStart = opener.index + opener[0].length
		closerPattern.lastIndex = valueStart
		const closer = closerPattern.exec(body)
		if (!closer) return undefined
		const raw = body.slice(valueStart, closer.index)
		if (/<(?:antml:)?parameter\b/i.test(raw)) return undefined
		const name = opener[1]
		if (Object.hasOwn(input, name)) return undefined
		const converted = convertLeakedParamValue(raw.trim(), declaredParamType(schema, name))
		if (!converted) return undefined
		input[name] = converted.value
		consumedUpTo = closer.index + closer[0].length
		openerPattern.lastIndex = consumedUpTo
	}

	if (body.slice(consumedUpTo).trim()) {
		return undefined
	}
	if (schema !== undefined) {
		const props = schema.properties
		if (props === null || props === undefined || typeof props !== "object" || Array.isArray(props)) {
			return undefined
		}
		for (const parameterName of Object.keys(input)) {
			if (!Object.hasOwn(props as Record<string, unknown>, parameterName)) {
				return undefined
			}
		}
	}
	return input
}

export function extractLeakedToolCalls(
	text: string,
	validTools: ReadonlySet<string> | LeakedToolSchemas,
	precedingText = "",
): { calls: Array<{ name: string; input: Record<string, unknown> }>; leftoverText: string } {
	const scan = new QuotingScanState()
	scan.advance(precedingText)
	return extractLeakedToolCallsWithState(text, validTools, scan)
}

function extractLeakedToolCallsWithState(
	text: string,
	validTools: ReadonlySet<string> | LeakedToolSchemas,
	scan: QuotingScanState,
): { calls: Array<{ name: string; input: Record<string, unknown> }>; leftoverText: string } {
	const schemaFor = (name: string) =>
		validTools instanceof Map ? (validTools.get(name) as Record<string, unknown> | undefined) : undefined
	const calls: Array<{ name: string; input: Record<string, unknown> }> = []

	let leftover = ""
	let lastIndex = 0

	let scannedUpTo = 0

	const openPattern = /<(?:antml:)?invoke\s+name="([^"]+)"\s*>/gi
	const closePattern = /<\/(?:antml:)?invoke\s*>/gi
	const suffixes = narrationSuffixes(text)
	for (let open = openPattern.exec(text); open !== null; open = openPattern.exec(text)) {
		const bodyStart = open.index + open[0].length
		closePattern.lastIndex = bodyStart
		const close = closePattern.exec(text)

		if (!close) {
			break
		}
		const blockEnd = close.index + close[0].length
		leftover += text.slice(lastIndex, open.index)
		const name = open[1]
		scan.advance(text.slice(scannedUpTo, open.index))

		scannedUpTo = blockEnd
		const recoverable =
			validTools.has(name) && scan.isInsideFunctionCallsWrapper() && !isQuotedAsCode(suffixes, blockEnd, scan)

		const input = recoverable
			? parseLeakedInvokeParams(text.slice(bodyStart, close.index), schemaFor(name))
			: undefined
		if (input) {
			calls.push({ name, input })
		} else {
			leftover += text.slice(open.index, blockEnd)
		}
		lastIndex = blockEnd
		openPattern.lastIndex = blockEnd
	}
	leftover += text.slice(lastIndex)
	scan.advance(text.slice(scannedUpTo))

	if (calls.length > 0) {
		leftover = leftover.replace(/<\/?(?:antml:)?function_calls\s*>/gi, "")
	}

	return { calls, leftoverText: leftover }
}

const VSCODE_LM_BUDGET_CHARS_PER_TOKEN = 3

const VSCODE_LM_INPUT_BUDGET_FRACTION = 0.8

const MIN_TOOL_RESULT_CHARS = 2000

const IMAGE_PLACEHOLDER_CHARS = 64

function readToolResultText(block: Anthropic.Messages.ContentBlockParam): string | undefined {
	if (!block || (block as { type?: string }).type !== "tool_result") {
		return undefined
	}
	const content = (block as Anthropic.Messages.ToolResultBlockParam).content
	if (typeof content === "string") {
		return content
	}
	if (Array.isArray(content)) {
		return content
			.filter((part): part is Anthropic.Messages.TextBlockParam => (part as { type?: string })?.type === "text")
			.map((part) => part.text ?? "")
			.join("")
	}
	return undefined
}

function writeToolResultText(block: Anthropic.Messages.ContentBlockParam, text: string): void {
	const toolResult = block as Anthropic.Messages.ToolResultBlockParam
	const content = toolResult.content
	if (Array.isArray(content)) {
		const nonText = content.filter((part) => (part as { type?: string })?.type !== "text")
		toolResult.content = [{ type: "text", text }, ...nonText] as typeof content
		return
	}
	toolResult.content = text
}

function trimTrailingHighSurrogate(text: string): string {
	return text.length > 0 && (text.charCodeAt(text.length - 1) & 0xfc00) === 0xd800 ? text.slice(0, -1) : text
}

export function middleOutTruncate(text: string, maxChars: number): string {
	if (maxChars <= 0) {
		return ""
	}
	if (text.length <= maxChars) {
		return text
	}

	const buildMarker = (removed: number) =>
		`\n\n[... ${removed.toLocaleString("en-US")} characters truncated to fit the model context window ...]\n\n`

	const reservedMarkerLength = buildMarker(text.length).length

	if (maxChars <= reservedMarkerLength) {
		return trimTrailingHighSurrogate(text.slice(0, maxChars))
	}
	const keep = maxChars - reservedMarkerLength
	const headLength = Math.ceil(keep / 2)
	const tailLength = keep - headLength
	const head = trimTrailingHighSurrogate(text.slice(0, headLength))
	let tail = tailLength > 0 ? text.slice(text.length - tailLength) : ""

	if (tail.length > 0 && (tail.charCodeAt(0) & 0xfc00) === 0xdc00) {
		tail = tail.slice(1)
	}
	const removed = text.length - head.length - tail.length
	return `${head}${buildMarker(removed)}${tail}`
}

export function estimateMessagesChars(messages: Anthropic.Messages.MessageParam[]): number {
	return messages.reduce((sum, message) => sum + estimateContentChars(message.content), 0)
}

function estimateContentChars(content: Anthropic.Messages.MessageParam["content"]): number {
	if (typeof content === "string") {
		return content.length
	}
	if (!Array.isArray(content)) {
		return 0
	}
	let total = 0
	for (const block of content) {
		const type = (block as { type?: string })?.type
		if (type === "text") {
			total += (block as Anthropic.Messages.TextBlockParam).text?.length ?? 0
		} else if (type === "tool_result") {
			total += readToolResultText(block)?.length ?? 0
		} else if (type === "tool_use") {
			total += JSON.stringify((block as Anthropic.Messages.ToolUseBlockParam).input ?? {}).length
		} else if (type === "image") {
			total += IMAGE_PLACEHOLDER_CHARS
		}
	}
	return total
}

export function truncateToolResultsToFitWindow(
	messages: Anthropic.Messages.MessageParam[],
	budgetChars: number,
): { messages: Anthropic.Messages.MessageParam[]; remainingChars: number } {
	const initialTotal = () => messages.reduce((sum, message) => sum + estimateContentChars(message.content), 0)
	if (!Number.isFinite(budgetChars) || budgetChars <= 0) {
		return { messages, remainingChars: initialTotal() }
	}

	let total = initialTotal()
	if (total <= budgetChars) {
		return { messages, remainingChars: total }
	}

	const blockText = new Map<Anthropic.Messages.ContentBlockParam, string>()
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue
		}
		for (const block of message.content) {
			const text = readToolResultText(block)
			if (text !== undefined) {
				blockText.set(block, text)
			}
		}
	}
	const toolResultBlocks = [...blockText.keys()]
	toolResultBlocks.sort((a, b) => (blockText.get(b)?.length ?? 0) - (blockText.get(a)?.length ?? 0))

	for (const block of toolResultBlocks) {
		if (total <= budgetChars) {
			break
		}
		const text = blockText.get(block)
		if (text === undefined || text.length <= MIN_TOOL_RESULT_CHARS) {
			continue
		}

		const overage = total - budgetChars
		const target = Math.max(MIN_TOOL_RESULT_CHARS, text.length - overage)

		const truncated = middleOutTruncate(text, target)
		total -= text.length - truncated.length
		writeToolResultText(block, truncated)
	}

	return { messages, remainingChars: total }
}

/**
 * Handles interaction with VS Code's Language Model API for chat-based operations.
 * This handler extends BaseProvider to provide VS Code LM specific functionality.
 *
 * @extends {BaseProvider}
 *
 * @remarks
 * The handler manages a VS Code language model chat client and provides methods to:
 * - Create and manage chat client instances
 * - Stream messages using VS Code's Language Model API
 * - Retrieve model information
 *
 * @example
 * ```typescript
 * const options = {
 *   vsCodeLmModelSelector: { vendor: "copilot", family: "gpt-4" }
 * };
 * const handler = new VsCodeLmHandler(options);
 *
 * // Stream a conversation
 * const systemPrompt = "You are a helpful assistant";
 * const messages = [{ role: "user", content: "Hello!" }];
 * for await (const chunk of handler.createMessage(systemPrompt, messages)) {
 *   console.log(chunk);
 * }
 * ```
 */
export class VsCodeLmHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: vscode.LanguageModelChat | null
	private disposable: vscode.Disposable | null
	private currentRequestCancellation: vscode.CancellationTokenSource | null

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.client = null
		this.disposable = null
		this.currentRequestCancellation = null

		try {
			// Listen for model changes and reset client
			this.disposable = vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("lm")) {
					try {
						this.client = null
						this.ensureCleanState()
					} catch (error) {
						console.error("Error during configuration change cleanup:", error)
					}
				}
			})
			void this.resolveModelCapabilities()
		} catch (error) {
			// Ensure cleanup if constructor fails
			this.dispose()

			throw new Error(
				`Roo Code <Language Model API>: Failed to initialize handler: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}
	/**
	 * Initializes the VS Code Language Model client.
	 * This method is called during the constructor to set up the client.
	 * This useful when the client is not created yet and call getModel() before the client is created.
	 * @returns Promise<void>
	 * @throws Error when client initialization fails
	 */
	async initializeClient(): Promise<void> {
		try {
			// Check if the client is already initialized
			if (this.client) {
				console.debug("Roo Code <Language Model API>: Client already initialized")
				return
			}
			// Create a new client instance
			this.client = await this.createClient(this.options.vsCodeLmModelSelector || {})
			console.debug("Roo Code <Language Model API>: Client initialized successfully")
		} catch (error) {
			// Handle errors during client initialization
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error("Roo Code <Language Model API>: Client initialization failed:", errorMessage)
			throw new Error(`Roo Code <Language Model API>: Failed to initialize client: ${errorMessage}`)
		}
	}
	/**
	 * Creates a language model chat client based on the provided selector.
	 *
	 * @param selector - Selector criteria to filter language model chat instances
	 * @returns Promise resolving to the first matching language model chat instance
	 * @throws Error when no matching models are found with the given selector
	 *
	 * @example
	 * const selector = { vendor: "copilot", family: "gpt-4o" };
	 * const chatClient = await createClient(selector);
	 */
	async createClient(selector: vscode.LanguageModelChatSelector): Promise<vscode.LanguageModelChat> {
		try {
			const models = await vscode.lm.selectChatModels(selector)

			// Use first available model or create a minimal model object
			if (models && Array.isArray(models) && models.length > 0) {
				return models[0]
			}

			// Create a minimal model if no models are available
			return {
				id: "default-lm",
				name: "Default Language Model",
				vendor: "vscode",
				family: "lm",
				version: "1.0",
				maxInputTokens: 8192,
				sendRequest: async (_messages, _options, _token) => {
					// Provide a minimal implementation
					return {
						stream: (async function* () {
							yield new vscode.LanguageModelTextPart(
								"Language model functionality is limited. Please check VS Code configuration.",
							)
						})(),
						text: (async function* () {
							yield "Language model functionality is limited. Please check VS Code configuration."
						})(),
					}
				},
				countTokens: async () => 0,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			throw new Error(`Roo Code <Language Model API>: Failed to select model: ${errorMessage}`)
		}
	}

	/**
	 * Creates and streams a message using the VS Code Language Model API.
	 *
	 * @param systemPrompt - The system prompt to initialize the conversation context
	 * @param messages - An array of message parameters following the Anthropic message format
	 * @param metadata - Optional metadata for the message
	 *
	 * @yields {ApiStream} An async generator that yields either text chunks or tool calls from the model response
	 *
	 * @throws {Error} When vsCodeLmModelSelector option is not provided
	 * @throws {Error} When the response stream encounters an error
	 *
	 * @remarks
	 * This method handles the initialization of the VS Code LM client if not already created,
	 * converts the messages to VS Code LM format, and streams the response chunks.
	 * Tool calls handling is currently a work in progress.
	 */
	dispose(): void {
		if (this.disposable) {
			this.disposable.dispose()
		}

		if (this.currentRequestCancellation) {
			this.currentRequestCancellation.cancel()
			this.currentRequestCancellation.dispose()
		}
	}

	/**
	 * Implements the ApiHandler countTokens interface method
	 * Provides token counting for Anthropic content blocks
	 *
	 * @param content The content blocks to count tokens for
	 * @returns A promise resolving to the token count
	 */
	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		// Copilot undercounts tool results; use their length as a floor for condense decisions.
		const toolResultChars = content.reduce((sum, block) => sum + (readToolResultText(block)?.length ?? 0), 0)
		const lengthEstimate = Math.ceil(toolResultChars / VSCODE_LM_BUDGET_CHARS_PER_TOKEN)
		const containsImages = content.some(
			(block) =>
				block.type === "image" ||
				(block.type === "tool_result" &&
					Array.isArray(block.content) &&
					block.content.some((part) => part.type === "image")),
		)
		if (this.getModel().info.supportsImages === true && containsImages) {
			const counted = await this.calculateTotalInputTokens(
				convertToVsCodeLmMessages([{ role: "user", content }], { supportsImages: true }),
			)
			return Math.max(counted, lengthEstimate)
		}
		// Preserve text-only counting when native images cannot be sent.
		let textContent = ""

		for (const block of content) {
			if (block.type === "text") {
				textContent += block.text || ""
			} else if (block.type === "image") {
				textContent += "[IMAGE]"
			}
		}

		return Math.max(await this.internalCountTokens(textContent), lengthEstimate)
	}

	/**
	 * Private implementation of token counting used internally by VsCodeLmHandler
	 */
	private async internalCountTokens(text: string | vscode.LanguageModelChatMessage): Promise<number> {
		// Check for required dependencies
		if (!this.client) {
			console.warn("Roo Code <Language Model API>: No client available for token counting")
			return 0
		}

		// Validate input
		if (!text) {
			console.debug("Roo Code <Language Model API>: Empty text provided for token counting")
			return 0
		}

		// Create a temporary cancellation token if we don't have one (e.g., when called outside a request)
		let cancellationToken: vscode.CancellationToken
		let tempCancellation: vscode.CancellationTokenSource | null = null

		if (this.currentRequestCancellation) {
			cancellationToken = this.currentRequestCancellation.token
		} else {
			tempCancellation = new vscode.CancellationTokenSource()
			cancellationToken = tempCancellation.token
		}

		try {
			// Handle different input types
			let tokenCount: number

			if (typeof text === "string") {
				tokenCount = await this.client.countTokens(text, cancellationToken)
			} else if (this.getModel().info.supportsImages === true) {
				tokenCount = await this.client.countTokens(text, cancellationToken)
			} else if (text instanceof vscode.LanguageModelChatMessage) {
				// For chat messages, ensure we have content
				if (!text.content || (Array.isArray(text.content) && text.content.length === 0)) {
					console.debug("Roo Code <Language Model API>: Empty chat message content")
					return 0
				}
				const countMessage = extractTextCountFromMessage(text)
				tokenCount = await this.client.countTokens(countMessage, cancellationToken)
			} else {
				console.warn("Roo Code <Language Model API>: Invalid input type for token counting")
				return 0
			}

			// Validate the result
			if (typeof tokenCount !== "number") {
				console.warn("Roo Code <Language Model API>: Non-numeric token count received:", tokenCount)
				return 0
			}

			if (tokenCount < 0) {
				console.warn("Roo Code <Language Model API>: Negative token count received:", tokenCount)
				return 0
			}

			return tokenCount
		} catch (error) {
			// Handle specific error types
			if (error instanceof vscode.CancellationError) {
				console.debug("Roo Code <Language Model API>: Token counting cancelled by user")
				return 0
			}

			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.warn("Roo Code <Language Model API>: Token counting failed:", errorMessage)

			// Log additional error details if available
			if (error instanceof Error && error.stack) {
				console.debug("Token counting error stack:", error.stack)
			}

			return 0 // Fallback to prevent stream interruption
		} finally {
			// Clean up temporary cancellation token
			if (tempCancellation) {
				tempCancellation.dispose()
			}
		}
	}

	private async countTokensStrict(message: vscode.LanguageModelChatMessage): Promise<number> {
		const temporaryCancellation = this.currentRequestCancellation ? null : new vscode.CancellationTokenSource()
		const cancellationToken = (this.currentRequestCancellation ?? temporaryCancellation!).token
		try {
			if (!this.client || cancellationToken.isCancellationRequested) throw new Error("Measurement unavailable")
			const tokenCount = await this.client.countTokens(message, cancellationToken)
			if (
				cancellationToken.isCancellationRequested ||
				typeof tokenCount !== "number" ||
				!Number.isFinite(tokenCount) ||
				tokenCount < 0
			) {
				throw new Error("Invalid measurement")
			}
			return tokenCount
		} catch (error) {
			console.warn("Roo Code <Language Model API>: Request size measurement failed:", error)
			throw new Error("Roo Code <Language Model API>: Could not measure request size. The request was not sent.")
		} finally {
			temporaryCancellation?.dispose()
		}
	}

	private async calculateTotalInputTokens(
		vsCodeLmMessages: vscode.LanguageModelChatMessage[],
		strict = false,
	): Promise<number> {
		const messageTokens: number[] = await Promise.all(
			vsCodeLmMessages.map((message) =>
				strict ? this.countTokensStrict(message) : this.internalCountTokens(message),
			),
		)

		return messageTokens.reduce((sum: number, tokens: number): number => sum + tokens, 0)
	}

	private ensureCleanState(): void {
		if (this.currentRequestCancellation) {
			this.currentRequestCancellation.cancel()
			this.currentRequestCancellation.dispose()
			this.currentRequestCancellation = null
		}
	}

	async resolveModelCapabilities(): Promise<void> {
		try {
			await this.getClient()
		} catch {
			// The send path reports acquisition errors; pre-filter discovery must not reject text requests.
			this.client = null
		}
	}

	private async getClient(): Promise<vscode.LanguageModelChat> {
		if (!this.client) {
			console.debug("Roo Code <Language Model API>: Getting client with options:", {
				vsCodeLmModelSelector: this.options.vsCodeLmModelSelector,
				hasOptions: !!this.options,
				selectorKeys: this.options.vsCodeLmModelSelector ? Object.keys(this.options.vsCodeLmModelSelector) : [],
			})

			try {
				// Use default empty selector if none provided to get all available models
				const selector = this.options?.vsCodeLmModelSelector || {}
				console.debug("Roo Code <Language Model API>: Creating client with selector:", selector)
				this.client = await this.createClient(selector)
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error"
				console.error("Roo Code <Language Model API>: Client creation failed:", message)
				throw new Error(`Roo Code <Language Model API>: Failed to create client: ${message}`)
			}
		}

		return this.client
	}

	private cleanMessageContent(content: any): any {
		if (!content) {
			return content
		}

		if (typeof content === "string") {
			return content
		}

		if (Array.isArray(content)) {
			return content.map((item) => this.cleanMessageContent(item))
		}

		if (typeof content === "object") {
			const cleaned: any = {}
			for (const [key, value] of Object.entries(content)) {
				cleaned[key] = this.cleanMessageContent(value)
			}
			return cleaned
		}

		return content
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Ensure clean state before starting a new request
		this.ensureCleanState()
		const client: vscode.LanguageModelChat = await this.getClient()

		// Process messages
		const cleanedMessages = messages.map((msg) => ({
			...msg,
			content: this.cleanMessageContent(msg.content),
		}))

		let lengthEstimatedInputTokens = 0
		const budget = this.getMessagesBudget(systemPrompt, metadata)
		if (budget) {
			const { rawBudgetChars, toolSchemaChars } = budget
			const messagesBudgetChars = Math.max(MIN_TOOL_RESULT_CHARS, rawBudgetChars)
			const { remainingChars } = truncateToolResultsToFitWindow(cleanedMessages, messagesBudgetChars)
			// Copilot undercounts tool results ~10x; report at least the length estimate.
			lengthEstimatedInputTokens = Math.ceil(
				(remainingChars + systemPrompt.length + toolSchemaChars) / VSCODE_LM_BUDGET_CHARS_PER_TOKEN,
			)

			if (remainingChars > rawBudgetChars) {
				throw Object.assign(
					new Error(
						"Roo Code <Language Model API>: The request is too large for this model's context window " +
							`(estimated ${remainingChars.toLocaleString("en-US")} characters against a budget of ` +
							`${Math.max(0, Math.floor(rawBudgetChars)).toLocaleString("en-US")}), and it cannot be reduced further without ` +
							"breaking tool-call pairing. Condense the conversation or start a new task.",
					),
					{ status: CONTEXT_WINDOW_EXCEEDED_STATUS },
				)
			}
		}

		// Convert Anthropic messages to VS Code LM messages
		const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.Assistant(sanitizeSurrogates(systemPrompt)),
			...convertToVsCodeLmMessages(cleanedMessages, {
				supportsImages: this.getModel().info.supportsImages === true,
			}),
		]

		// Initialize cancellation token for the request
		this.currentRequestCancellation = new vscode.CancellationTokenSource()

		// Calculate input tokens before starting the stream
		const modelInfo = this.getModel().info
		let totalInputTokens: number
		try {
			totalInputTokens = await this.calculateTotalInputTokens(vsCodeLmMessages, modelInfo.supportsImages === true)
			if (
				modelInfo.supportsImages === true &&
				totalInputTokens >
					Math.min(modelInfo.contextWindow, metadata?.condenseAllowance ?? modelInfo.contextWindow)
			) {
				throw Object.assign(
					new Error(
						"Roo Code <Language Model API>: The request exceeds the selected model's input context window. " +
							"Condense the conversation or start a new task.",
					),
					{ status: CONTEXT_WINDOW_EXCEEDED_STATUS },
				)
			}
		} catch (error) {
			this.ensureCleanState()
			throw error
		}

		// Accumulate the text and count at the end of the stream to reduce token counting overhead.
		let accumulatedText: string = ""

		const providedTools = (metadata?.tools ?? [])
			.filter((tool) => tool.type === "function")
			.filter((tool) => tool.function.name.length > 0)
		const providedToolSchemas = new Map<string, Record<string, unknown> | undefined>()
		const encodedToolAliases = new Map<string, string>()
		const ambiguousNames = new Set<string>()
		const declaredNames = new Map<string, string>()
		for (const tool of providedTools) {
			const originalName = tool.function.name
			const encodedName = sanitizeToolNameSurrogates(originalName)
			declaredNames.set(encodedName, originalName)
			for (const alias of new Set([originalName, encodedName])) {
				if (providedToolSchemas.has(alias)) {
					ambiguousNames.add(alias)
				} else {
					providedToolSchemas.set(alias, tool.function.parameters as Record<string, unknown> | undefined)
					encodedToolAliases.set(alias, originalName)
				}
			}
		}
		for (const alias of ambiguousNames) providedToolSchemas.delete(alias)
		const salvageLeakedToolCalls = providedToolSchemas.size > 0
		let salvageBuffer: string[] | undefined
		let salvageCarry = ""
		let salvageCarryIsInvokeWhitespace = false
		let salvagePrecedingText: string[] = []
		const salvageScan = new QuotingScanState()
		let salvagedToolCallIndex = 0
		const salvageRequestId = salvageRequestIndex++

		const parseSalvage = (span: string): ApiStreamChunk[] => {
			const drained: ApiStreamChunk[] = []
			const { calls, leftoverText } = extractLeakedToolCallsWithState(span, providedToolSchemas, salvageScan)
			if (leftoverText) {
				drained.push({ type: "text", text: leftoverText })
			}
			for (const call of calls) {
				const originalName = encodedToolAliases.get(call.name) ?? call.name
				console.warn(
					"Roo Code <Language Model API>: Recovered a tool call the model emitted as text instead of a structured tool call:",
					{ name: originalName, params: Object.keys(call.input) },
				)
				drained.push({
					type: "tool_call",
					id: `vscodelm-salvaged-${salvageRequestId}-${salvagedToolCallIndex++}`,
					name: originalName,
					arguments: JSON.stringify(call.input),
				})
			}
			return drained
		}

		const flushSalvage = (): ApiStreamChunk[] => {
			if (this.currentRequestCancellation?.token.isCancellationRequested) {
				salvageBuffer = undefined
				salvageCarry = ""
				return []
			}
			if (!salvageLeakedToolCalls) {
				return []
			}

			salvageScan.advance(salvagePrecedingText.join(""))
			salvagePrecedingText = []
			if (!salvageBuffer) {
				const carried = salvageCarry
				salvageCarry = ""
				salvageCarryIsInvokeWhitespace = false
				salvageScan.advance(carried)
				return carried ? [{ type: "text", text: carried }] : []
			}

			const buffered = salvageBuffer.join("")
			salvageBuffer = undefined
			return parseSalvage(buffered)
		}

		try {
			// Create the response stream with required options
			const requestOptions: vscode.LanguageModelChatRequestOptions = {
				justification: `Roo Code would like to use '${client.name}' from '${client.vendor}', Click 'Allow' to proceed.`,
				tools: convertToVsCodeLmTools(metadata?.tools ?? []),
			}

			const response: vscode.LanguageModelChatResponse = await client.sendRequest(
				vsCodeLmMessages,
				requestOptions,
				this.currentRequestCancellation.token,
			)

			// Consume the stream and handle both text and tool call chunks
			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					// Validate text part value
					if (typeof chunk.value !== "string") {
						console.warn("Roo Code <Language Model API>: Invalid text part value received:", chunk.value)
						continue
					}

					accumulatedText += chunk.value

					// Fast path: when we didn't offer any tools there is nothing to salvage, so
					// stream the text straight through exactly as before.
					if (!salvageLeakedToolCalls) {
						yield { type: "text", text: chunk.value }
						continue
					}

					if (salvageBuffer) {
						salvageBuffer.push(chunk.value)
						continue
					}

					// Unfinished invokes allow unlimited whitespace; avoid rescanning it per chunk.
					if (salvageCarryIsInvokeWhitespace && /^\s*$/.test(chunk.value)) {
						salvageCarry += chunk.value
						continue
					}
					salvageCarryIsInvokeWhitespace = false

					// Watch for the start of a leaked tool-call block, carrying a small tail across
					// chunks so a marker split across chunk boundaries is still detected.
					const combined = salvageCarry + chunk.value
					const markerMatch = combined.match(LEAKED_TOOL_CALL_START)
					if (markerMatch) {
						const before = combined.slice(0, markerMatch.index)
						if (before) {
							salvagePrecedingText.push(before)
							yield { type: "text", text: before }
						}
						salvageBuffer = [combined.slice(markerMatch.index)]
						salvageCarry = ""
					} else {
						const carryLength = trailingPartialToolMarkerLength(combined)
						const emit = carryLength > 0 ? combined.slice(0, combined.length - carryLength) : combined
						salvageCarry = carryLength > 0 ? combined.slice(combined.length - carryLength) : ""
						salvageCarryIsInvokeWhitespace = /^<(?:antml:)?invoke\s+$/i.test(salvageCarry)
						if (emit) {
							salvagePrecedingText.push(emit)
							yield { type: "text", text: emit }
						}
					}
				} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
					yield* flushSalvage()
					try {
						// Validate tool call parameters
						if (!chunk.name || typeof chunk.name !== "string") {
							console.warn("Roo Code <Language Model API>: Invalid tool name received:", chunk.name)
							continue
						}

						if (!chunk.callId || typeof chunk.callId !== "string") {
							console.warn("Roo Code <Language Model API>: Invalid tool callId received:", chunk.callId)
							continue
						}

						// Ensure input is a valid object
						if (!chunk.input || typeof chunk.input !== "object") {
							console.warn("Roo Code <Language Model API>: Invalid tool input received:", chunk.input)
							continue
						}

						// Log tool call for debugging
						console.debug("Roo Code <Language Model API>: Processing tool call:", {
							name: chunk.name,
							callId: chunk.callId,
							inputSize: JSON.stringify(chunk.input).length,
						})

						// Yield native tool_call chunk when tools are provided
						if (metadata?.tools?.length) {
							const argumentsString = JSON.stringify(chunk.input)
							accumulatedText += argumentsString
							yield {
								type: "tool_call",
								id: chunk.callId,
								name: declaredNames.get(chunk.name) ?? chunk.name,
								arguments: argumentsString,
							}
						}
					} catch (error) {
						console.error("Roo Code <Language Model API>: Failed to process tool call:", error)
						// Continue processing other chunks even if one fails
						continue
					}
				} else {
					console.warn("Roo Code <Language Model API>: Unknown chunk type received:", chunk)
				}
			}

			yield* flushSalvage()

			// Count tokens in the accumulated text after stream completion
			const totalOutputTokens: number = await this.internalCountTokens(accumulatedText)

			// Report final usage after stream completion
			yield {
				type: "usage",
				inputTokens: Math.max(totalInputTokens, lengthEstimatedInputTokens),
				outputTokens: totalOutputTokens,
			}
		} catch (error: unknown) {
			this.ensureCleanState()

			if (error instanceof vscode.CancellationError) {
				throw new Error("Roo Code <Language Model API>: Request cancelled by user")
			}

			if (error instanceof Error) {
				console.error("Roo Code <Language Model API>: Stream error details:", {
					message: error.message,
					stack: error.stack,
					name: error.name,
				})

				// Return original error if it's already an Error instance
				throw error
			} else if (typeof error === "object" && error !== null) {
				// Handle error-like objects
				const errorDetails = JSON.stringify(error, null, 2)
				console.error("Roo Code <Language Model API>: Stream error object:", errorDetails)
				throw new Error(`Roo Code <Language Model API>: Response stream error: ${errorDetails}`)
			} else {
				// Fallback for unknown error types
				const errorMessage = String(error)
				console.error("Roo Code <Language Model API>: Unknown stream error:", errorMessage)
				throw new Error(`Roo Code <Language Model API>: Response stream error: ${errorMessage}`)
			}
		}
	}

	// Return model information based on the current client state
	override getModel(): { id: string; info: ModelInfo } {
		if (this.client) {
			// Validate client properties
			const requiredProps = {
				id: this.client.id,
				vendor: this.client.vendor,
				family: this.client.family,
				version: this.client.version,
				maxInputTokens: this.client.maxInputTokens,
			}

			// Log any missing properties for debugging
			for (const [prop, value] of Object.entries(requiredProps)) {
				if (!value && value !== 0) {
					console.warn(`Roo Code <Language Model API>: Client missing ${prop} property`)
				}
			}

			// Construct model ID using available information
			const modelParts = [this.client.vendor, this.client.family, this.client.version].filter(Boolean)

			const modelId = this.client.id || modelParts.join(SELECTOR_SEPARATOR)

			// Build model info with conservative defaults for missing values
			const modelInfo: ModelInfo = {
				maxTokens: -1, // Unlimited tokens by default
				contextWindow:
					typeof this.client.maxInputTokens === "number"
						? Math.max(0, this.client.maxInputTokens)
						: openAiModelInfoSaneDefaults.contextWindow,
				supportsImages: canCreateImageParts() ? reportedImageSupport(this.client) : false,
				supportsPromptCache: true,
				inputPrice: 0,
				outputPrice: 0,
				description: `VSCode Language Model: ${modelId}`,
			}

			return { id: modelId, info: modelInfo }
		}

		// Fallback when no client is available
		const fallbackId = this.options.vsCodeLmModelSelector
			? stringifyVsCodeLmModelSelector(this.options.vsCodeLmModelSelector)
			: "vscode-lm"

		console.debug("Roo Code <Language Model API>: No client available, using fallback model info")

		return {
			id: fallbackId,
			info: {
				...openAiModelInfoSaneDefaults,
				supportsImages: undefined,
				description: `VSCode Language Model (Fallback): ${fallbackId}`,
			},
		}
	}

	// Copilot's advertised client.maxInputTokens can prevent auto-condense by overstating usable input.
	// Context management shares the static maxInputTokens with useSelectedModel to keep gate and gauge aligned.
	// Catalog drift uses the default row, not the inflated live window; only a non-positive static budget falls back to live.
	getCondenseContextWindow(): number {
		const family = this.client?.family ?? this.options.vsCodeLmModelSelector?.family
		const vendor = this.client?.vendor ?? this.options.vsCodeLmModelSelector?.vendor
		const staticModel =
			family && (family !== "claude-fable-5.2" || vendor === "copilot")
				? (vscodeLlmModels[family as keyof typeof vscodeLlmModels] ?? vscodeLlmModels[vscodeLlmDefaultModelId])
				: vscodeLlmModels[vscodeLlmDefaultModelId]

		if (staticModel && typeof staticModel.maxInputTokens === "number" && staticModel.maxInputTokens > 0) {
			return staticModel.maxInputTokens
		}

		return this.getModel().info.contextWindow
	}

	measureInputOverageChars(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): number {
		const budget = this.getMessagesBudget(systemPrompt, metadata)
		return budget ? estimateMessagesChars(messages) - budget.rawBudgetChars : 0
	}

	private getMessagesBudget(
		systemPrompt: string,
		metadata?: ApiHandlerCreateMessageMetadata,
	): { rawBudgetChars: number; toolSchemaChars: number } | undefined {
		const contextWindowTokens = this.getCondenseContextWindow()
		if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
			return undefined
		}
		const toolSchemaChars = metadata?.tools ? JSON.stringify(metadata.tools).length : 0
		const rawBudgetChars =
			contextWindowTokens * VSCODE_LM_INPUT_BUDGET_FRACTION * VSCODE_LM_BUDGET_CHARS_PER_TOKEN -
			systemPrompt.length -
			toolSchemaChars
		return { rawBudgetChars, toolSchemaChars }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const client = await this.getClient()
			const response = await client.sendRequest(
				[vscode.LanguageModelChatMessage.User(sanitizeSurrogates(prompt))],
				{},
				new vscode.CancellationTokenSource().token,
			)
			let result = ""
			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					result += chunk.value
				}
			}
			return result
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`VSCode LM completion error: ${error.message}`)
			}
			throw error
		}
	}
}

// Static blacklist of VS Code Language Model IDs that should be excluded from the model list e.g. because they will never work
const VSCODE_LM_STATIC_BLACKLIST: string[] = ["claude-3.7-sonnet", "claude-3.7-sonnet-thought"]

export async function getVsCodeLmModels() {
	try {
		const models = (await vscode.lm.selectChatModels({})) || []
		return models
			.filter((model) => !VSCODE_LM_STATIC_BLACKLIST.includes(model.id))
			.map((model) => ({
				id: model.id,
				vendor: model.vendor,
				family: model.family,
				version: model.version,
				name: model.name,
				maxInputTokens: model.maxInputTokens,
				supportsImages: canCreateImageParts() ? reportedImageSupport(model) : false,
			}))
	} catch (error) {
		console.error(
			`Error fetching VS Code LM models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
		return []
	}
}
