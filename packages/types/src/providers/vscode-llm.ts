import type { ModelInfo } from "../model.js"

export type VscodeLlmModelId = keyof typeof vscodeLlmModels

export const vscodeLlmDefaultModelId: VscodeLlmModelId = "claude-sonnet-4.5"

// Rows below were originally enumerated from `vscode.lm.selectChatModels({ vendor: "copilot" })`.
// The VS Code LM API exposes ONLY `maxInputTokens` (there is no separate context-window field), and
// that is the single value the runtime/condense gate enforces: getModel() sets
// contextWindow = Math.max(0, client.maxInputTokens) in src/api/providers/vscode-lm.ts. So for every
// row `maxInputTokens` IS the enforced context window, and `contextWindow` is set equal to it purely
// as an informational mirror (the UI reads maxInputTokens via useSelectedModel.ts, so the two MUST
// match to keep the context bar and the gate on one source of truth).
// These ceilings were measured empirically on 2026-06-18 (VS Code 1.125.0) by binary-searching the
// single-message "Message exceeds token limit" threshold per model — they are the largest input the
// backend actually accepts, which for several models is well below the value Copilot advertises:
//   - claude-opus-4.8:                                   enforced 679560
//   - claude-opus-4.7 / 4.6, claude-sonnet-4.6,
//     gemini-3.1-pro-preview, gemini-3.5-flash:          enforced ~197.9K
//   - gpt-5.5 / gpt-5.4:                                 enforced ~268.4K
// Guardrail: these are empirically measured — re-measure (do not hand-tune) if the models change.
// See GitHub issue simurg79/Roo-Code#10 and myplans/VSCode LM Model Table Integrity/vscode_lm_opus_data_integrity_design.md.
export const vscodeLlmModels = {
	"claude-opus-4.8": {
		contextWindow: 679560,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "claude-opus-4.8",
		version: "claude-opus-4.8",
		name: "Claude Opus 4.8",
		supportsToolCalling: true,
		maxInputTokens: 197897,
	},
	"claude-opus-4.7": {
		contextWindow: 197897,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "claude-opus-4.7",
		version: "claude-opus-4.7",
		name: "Claude Opus 4.7",
		supportsToolCalling: true,
		maxInputTokens: 197897,
	},
	"claude-opus-4.6": {
		contextWindow: 197897,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "claude-opus-4.6",
		version: "claude-opus-4.6",
		name: "Claude Opus 4.6",
		supportsToolCalling: true,
		maxInputTokens: 197897,
	},
	"claude-opus-4.5": {
		contextWindow: 167790,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "claude-opus-4.5",
		version: "claude-opus-4.5",
		name: "Claude Opus 4.5",
		supportsToolCalling: true,
		maxInputTokens: 167790,
	},
	"claude-sonnet-4.6": {
		contextWindow: 197896,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "claude-sonnet-4.6",
		version: "claude-sonnet-4.6",
		name: "Claude Sonnet 4.6",
		supportsToolCalling: true,
		maxInputTokens: 197896,
	},
	"claude-sonnet-4.5": {
		contextWindow: 167790,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "claude-sonnet-4.5",
		version: "claude-sonnet-4.5",
		name: "Claude Sonnet 4.5",
		supportsToolCalling: true,
		maxInputTokens: 167790,
	},
	"claude-haiku-4.5": {
		contextWindow: 135790,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "claude-haiku-4.5",
		version: "claude-haiku-4.5",
		name: "Claude Haiku 4.5",
		supportsToolCalling: true,
		maxInputTokens: 135790,
	},
	"gpt-5.5": {
		contextWindow: 268426,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-5.5",
		version: "gpt-5.5",
		name: "GPT-5.5",
		supportsToolCalling: true,
		maxInputTokens: 268426,
	},
	"gpt-5.4": {
		contextWindow: 268424,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-5.4",
		version: "gpt-5.4",
		name: "GPT-5.4",
		supportsToolCalling: true,
		maxInputTokens: 268424,
	},
	"gpt-5.4-mini": {
		contextWindow: 271790,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-5.4-mini",
		version: "gpt-5.4-mini",
		name: "GPT-5.4 mini",
		supportsToolCalling: true,
		maxInputTokens: 271790,
	},
	"gpt-5.3-codex": {
		contextWindow: 271790,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-5.3-codex",
		version: "gpt-5.3-codex",
		name: "GPT-5.3-Codex",
		supportsToolCalling: true,
		maxInputTokens: 271790,
	},
	"gpt-5-mini": {
		contextWindow: 127790,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-5-mini",
		version: "gpt-5-mini",
		name: "GPT-5 mini",
		supportsToolCalling: true,
		maxInputTokens: 127790,
	},
	"gpt-4o-mini": {
		contextWindow: 12078,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gpt-4o-mini",
		version: "gpt-4o-mini-2024-07-18",
		name: "GPT-4o mini",
		supportsToolCalling: true,
		maxInputTokens: 12078,
	},
	"gemini-3.1-pro-preview": {
		contextWindow: 197897,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gemini-3.1-pro-preview",
		version: "gemini-3.1-pro-preview",
		name: "Gemini 3.1 Pro (Preview)",
		supportsToolCalling: true,
		maxInputTokens: 197897,
	},
	"gemini-3.5-flash": {
		contextWindow: 197895,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gemini-3.5-flash",
		version: "gemini-3.5-flash",
		name: "Gemini 3.5 Flash",
		supportsToolCalling: true,
		maxInputTokens: 197895,
	},
	"gemini-3-flash": {
		contextWindow: 108594,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gemini-3-flash",
		version: "gemini-3-flash-preview",
		name: "Gemini 3 Flash (Preview)",
		supportsToolCalling: true,
		maxInputTokens: 108594,
	},
	"gemini-2.5-pro": {
		contextWindow: 108594,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		family: "gemini-2.5-pro",
		version: "gemini-2.5-pro",
		name: "Gemini 2.5 Pro",
		supportsToolCalling: true,
		maxInputTokens: 108594,
	},
} as const satisfies Record<
	string,
	ModelInfo & {
		family: string
		version: string
		name: string
		supportsToolCalling: boolean
		maxInputTokens: number
	}
>
