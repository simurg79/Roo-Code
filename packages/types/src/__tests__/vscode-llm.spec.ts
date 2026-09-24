import { describe, it, expect } from "vitest"

import { vscodeLlmModels, vscodeLlmDefaultModelId } from "../providers/vscode-llm.js"

// The five families added and the two refreshed on 2026-09-10 (VS Code 1.137.0), with Astra remeasured 2026-09-23.
const SCOPED_ROWS = {
	"gpt-6-astra": { contextWindow: 921793, maxInputTokens: 271789, supportsImages: true },
	"grok-4.5": { contextWindow: 424794, maxInputTokens: 199783, supportsImages: false },
	"grok-4.6": { contextWindow: 424794, maxInputTokens: 199784, supportsImages: false },
	"gemini-3.7-flash": { contextWindow: 935793, maxInputTokens: 935783, supportsImages: true },
	"gemini-3.8-flash": { contextWindow: 982833, maxInputTokens: 955113, supportsImages: true },
	"claude-opus-5": { contextWindow: 935793, maxInputTokens: 680456, supportsImages: true },
	"gemini-3.6-flash": { contextWindow: 935793, maxInputTokens: 935785, supportsImages: true },
} as const

const REFRESHED_FAMILIES = Object.keys(SCOPED_ROWS) as Array<keyof typeof SCOPED_ROWS>

describe("vscodeLlmModels", () => {
	it("exposes the opus-4.8 row with its measured maxInputTokens and contextWindow", () => {
		// claude-opus-4.8 intentionally DIVERGES: maxInputTokens (197897) is the enforced ceiling the
		// UI reads, contextWindow (679560) the larger advertised window. Assert the on-disk literals
		// rather than forcing equality.
		expect(vscodeLlmModels).toHaveProperty("claude-opus-4.8")
		expect(vscodeLlmModels["claude-opus-4.8"].contextWindow).toBe(679560)
		expect(vscodeLlmModels["claude-opus-4.8"].maxInputTokens).toBe(197897)
	})

	it("preserves the real window for models captured with a smaller maxInputTokens", () => {
		expect(vscodeLlmModels["gpt-4o-mini"].maxInputTokens).toBe(12078)
		expect(vscodeLlmModels["gpt-4o-mini"].contextWindow).toBe(12078)
		expect(vscodeLlmModels["gemini-2.5-pro"].contextWindow).toBe(108594)
		expect(vscodeLlmModels["gemini-2.5-pro"].maxInputTokens).toBe(108594)
	})

	it("includes the 2026-07-14 additions with their measured single-message ceilings", () => {
		// Measured by single-message binary search on VS Code 1.126.0. claude-sonnet-5 accepts nearly
		// its full window (925449) unlike older claude rows capped at ~197.9K — which is why values
		// are measured, not inferred from a sibling row.
		expect(vscodeLlmModels["claude-sonnet-5"].maxInputTokens).toBe(925449)
		expect(vscodeLlmModels["claude-sonnet-5"].contextWindow).toBe(925449)
		expect(vscodeLlmModels["gpt-5.6-luna"].maxInputTokens).toBe(199753)
		expect(vscodeLlmModels["gpt-5.6-sol"].maxInputTokens).toBe(271785)
		expect(vscodeLlmModels["gpt-5.6-terra"].maxInputTokens).toBe(271785)
	})

	it("replaces the conservative 197897 placeholders with the 2026-09-10 measured ceilings", () => {
		// These rows previously carried the placeholder 197897 (a borrowed sibling ceiling, not a
		// measurement); the 2026-09-10 bracket-derived values supersede it. contextWindow is
		// unchanged, so a failure here means the ceiling reverted to the placeholder.
		expect(vscodeLlmModels["claude-opus-5"].maxInputTokens).toBe(680456)
		expect(vscodeLlmModels["claude-opus-5"].contextWindow).toBe(935793)
		expect(vscodeLlmModels["gemini-3.6-flash"].maxInputTokens).toBe(935785)
		expect(vscodeLlmModels["gemini-3.6-flash"].contextWindow).toBe(935793)
	})

	it("leaves no 2026-09-10 scoped family pinned to the 197897 placeholder", () => {
		// Untouched rows (e.g. claude-opus-4.7) legitimately still measure 197897, so this guard is
		// limited to the families this refresh touched.
		for (const family of REFRESHED_FAMILIES) {
			expect(vscodeLlmModels[family].maxInputTokens, `${family} must not be the 197897 placeholder`).not.toBe(
				197897,
			)
		}
	})

	it("pins every 2026-09-10 row's windows and capability flags", () => {
		for (const [family, expected] of Object.entries(SCOPED_ROWS)) {
			const model = vscodeLlmModels[family as keyof typeof vscodeLlmModels]

			expect(model.maxInputTokens, `${family}: maxInputTokens`).toBe(expected.maxInputTokens)
			expect(model.contextWindow, `${family}: contextWindow`).toBe(expected.contextWindow)
			expect(model.supportsImages, `${family}: supportsImages`).toBe(expected.supportsImages)

			// Caching false is a schema default, not a backend claim. Keep legacy zero prices except
			// Astra's unmeasured prices, whose omission is checked separately below.
			expect(model.supportsPromptCache, `${family}: supportsPromptCache`).toBe(false)
			if (family !== "gpt-6-astra") {
				expect(model, `${family}: inputPrice`).toHaveProperty("inputPrice", 0)
				expect(model, `${family}: outputPrice`).toHaveProperty("outputPrice", 0)
			}
			expect(model.supportsToolCalling, `${family}: supportsToolCalling`).toBe(true)

			// Provider and gauge look rows up by the live client's family string, so the key, family
			// and version must agree or lookups silently degrade to the default row.
			expect(model.family, `${family}: family`).toBe(family)
			expect(model.version, `${family}: version`).toBe(family)
		}
	})

	it("records the 2026-09-23 Opus 5.5 row at its verified accepted lower bound", () => {
		// 677108 is the largest ACCEPTED request over 13 trials (VS Code 1.137.0, copilot), not the
		// exact ceiling — 695778 was rejected and model-declined errors left the bracket open.
		// Images and tool calling were observed; prompt caching remains unverified.
		expect(vscodeLlmModels).toHaveProperty("claude-opus-5.5")
		expect(vscodeLlmModels["claude-opus-5.5"].maxInputTokens).toBe(677108)
		expect(vscodeLlmModels["claude-opus-5.5"].contextWindow).toBe(871793)
		expect(vscodeLlmModels["claude-opus-5.5"].family).toBe("claude-opus-5.5")
		expect(vscodeLlmModels["claude-opus-5.5"].version).toBe("claude-opus-5.5")
		expect(vscodeLlmModels["claude-opus-5.5"].name).toBe("Claude Opus 5.5")
		expect(vscodeLlmModels["claude-opus-5.5"].supportsImages).toBe(true)
		expect(vscodeLlmModels["claude-opus-5.5"].supportsToolCalling).toBe(true)
		expect(vscodeLlmModels["claude-opus-5.5"].supportsPromptCache).toBe(false)
		expect(vscodeLlmModels["claude-opus-5.5"].inputPrice).toBe(0)
		expect(vscodeLlmModels["claude-opus-5.5"].outputPrice).toBe(0)
	})

	it("records the 2026-09-23 measured GPT-6 Astra row without unmeasured pricing or caching claims", () => {
		// 271789 accepted with an adjacent rejection at 271790 over 20 trials; images and tool calling
		// observed. supportsPromptCache `false` is the required-schema default, NOT a verified result.
		const astra = vscodeLlmModels["gpt-6-astra"]
		expect(astra.maxInputTokens).toBe(271789)
		expect(astra.contextWindow).toBe(921793)
		expect(astra.family).toBe("gpt-6-astra")
		expect(astra.version).toBe("gpt-6-astra")
		expect(astra.name).toBe("GPT-6 Astra")
		expect(astra.supportsImages).toBe(true)
		expect(astra.supportsToolCalling).toBe(true)
		expect(astra.supportsPromptCache).toBe(false)
		// Pricing was never measured, and ModelInfo makes those fields optional, so they are omitted
		// rather than filled with zeros the way older hand-authored rows were.
		expect(astra).not.toHaveProperty("inputPrice")
		expect(astra).not.toHaveProperty("outputPrice")
	})

	it("keeps both window fields populated and positive for every row", () => {
		// The two fields are ALLOWED to differ (claude-opus-4.8: 679560 vs 197897), so equality is
		// deliberately NOT asserted. The invariant is positive integers on both fields; a missing or
		// zero value indicates hand-authored drift, not a captured row.
		for (const [family, model] of Object.entries(vscodeLlmModels)) {
			expect(model.contextWindow, `${family}: contextWindow must be a positive integer`).toBeGreaterThan(0)
			expect(model.maxInputTokens, `${family}: maxInputTokens must be a positive integer`).toBeGreaterThan(0)
		}
	})

	it("excludes fabricated/internal/alias families and the dropped legacy rows", () => {
		// These were never in the live capture, or were removed by the full table REPLACE; their
		// presence would signal hand-authored drift.
		expect(vscodeLlmModels).not.toHaveProperty("claude-opus-4.7-high")
		expect(vscodeLlmModels).not.toHaveProperty("claude-3.5-sonnet")
		expect(vscodeLlmModels).not.toHaveProperty("claude-4-sonnet")
		expect(vscodeLlmModels).not.toHaveProperty("auto")
		expect(vscodeLlmModels).not.toHaveProperty("copilot-utility")
		expect(vscodeLlmModels).not.toHaveProperty("copilot-utility-small")
	})

	it("defaults to a model id that exists in the table", () => {
		expect(vscodeLlmDefaultModelId).toBe("claude-sonnet-4.5")
		expect(vscodeLlmModels).toHaveProperty(vscodeLlmDefaultModelId)
	})
})
