import { describe, it, expect } from "vitest"

import { vscodeLlmModels, vscodeLlmDefaultModelId } from "../providers/vscode-llm.js"

describe("vscodeLlmModels", () => {
	it("exposes the opus-4.8 row with its measured maxInputTokens and contextWindow", () => {
		// The VS Code LM API exposes only maxInputTokens; that is the value the UI reads from this
		// table (useSelectedModel.ts). For claude-opus-4.8 the two fields intentionally DIVERGE:
		// maxInputTokens (197897) is the enforced input ceiling, while contextWindow (679560) records
		// the larger advertised window. The UI reads maxInputTokens, so the divergence is a deliberate
		// tripwire — assert the actual on-disk literals rather than forcing equality.
		// See GitHub issue simurg79/Roo-Code#10.
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
		// Measured via single-message binary search on VS Code 1.126.0 (largest input the backend
		// accepts). claude-sonnet-5 accepts nearly its full advertised window (925449), unlike the
		// older claude rows that cap at ~197.9K — this divergence is exactly why the values are
		// measured rather than inferred from a sibling row.
		expect(vscodeLlmModels["claude-sonnet-5"].maxInputTokens).toBe(925449)
		expect(vscodeLlmModels["claude-sonnet-5"].contextWindow).toBe(925449)
		expect(vscodeLlmModels["gpt-5.6-luna"].maxInputTokens).toBe(199753)
		expect(vscodeLlmModels["gpt-5.6-sol"].maxInputTokens).toBe(271785)
		expect(vscodeLlmModels["gpt-5.6-terra"].maxInputTokens).toBe(271785)
	})

	it("keeps both window fields populated and positive for every row", () => {
		// NOTE: contextWindow and maxInputTokens are intentionally ALLOWED to differ (claude-opus-4.8
		// diverges: 679560 vs 197897). The UI reads maxInputTokens, and that divergence is a deliberate
		// tripwire, so we do NOT assert contextWindow === maxInputTokens here (see simurg79/Roo-Code#10).
		// The meaningful invariant is that every row carries positive integers for both fields; a
		// missing/zero value would point to hand-authored drift rather than a real captured row.
		for (const [family, model] of Object.entries(vscodeLlmModels)) {
			expect(model.contextWindow, `${family}: contextWindow must be a positive integer`).toBeGreaterThan(0)
			expect(model.maxInputTokens, `${family}: maxInputTokens must be a positive integer`).toBeGreaterThan(0)
		}
	})

	it("excludes fabricated/internal/alias families and the dropped legacy rows", () => {
		// Integrity guards: these were never part of the authoritative live capture, or were
		// removed by the full table REPLACE. Their presence would signal hand-authored drift.
		expect(vscodeLlmModels).not.toHaveProperty("claude-opus-4.7-high")
		expect(vscodeLlmModels).not.toHaveProperty("claude-3.5-sonnet")
		expect(vscodeLlmModels).not.toHaveProperty("claude-4-sonnet")
	})

	it("defaults to a model id that exists in the table", () => {
		expect(vscodeLlmDefaultModelId).toBe("claude-sonnet-4.5")
		expect(vscodeLlmModels).toHaveProperty(vscodeLlmDefaultModelId)
	})
})
