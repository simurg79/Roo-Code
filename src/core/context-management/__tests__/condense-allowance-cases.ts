import type { WillManageContextOptions } from "../index"

const defaults = {
	contextWindow: 128000,
	maxTokens: 8192,
	autoCondenseContext: true,
	autoCondenseContextPercent: 75,
	profileThresholds: {},
	currentProfileId: "selected",
} satisfies Omit<WillManageContextOptions, "totalTokens" | "lastMessageTokens">

export const condenseAllowanceCases = [
	{ name: "global integer threshold", options: defaults },
	{ name: "global fractional threshold", options: { ...defaults, autoCondenseContextPercent: 33.333 } },
	{ name: "profile threshold", options: { ...defaults, profileThresholds: { selected: 60 } } },
	{ name: "profile inheritance", options: { ...defaults, profileThresholds: { selected: -1 } } },
	{ name: "invalid low profile", options: { ...defaults, profileThresholds: { selected: 4 } } },
	{ name: "invalid high profile", options: { ...defaults, profileThresholds: { selected: 101 } } },
	{ name: "auto-condense off", options: { ...defaults, autoCondenseContext: false } },
	{ name: "unlimited output", options: { ...defaults, maxTokens: -1 } },
	{ name: "default reservation", options: { ...defaults, maxTokens: null } },
	{ name: "available input", options: { ...defaults, useAvailableInputForContextPercent: true } },
	{
		name: "fractional available input",
		options: { ...defaults, autoCondenseContextPercent: 16.1, useAvailableInputForContextPercent: true },
	},
	{
		name: "unlimited available input",
		options: { ...defaults, maxTokens: -1, useAvailableInputForContextPercent: true },
	},
	{ name: "token boundary limits percent", options: { ...defaults, autoCondenseContextPercent: 100 } },
	{ name: "fractional token boundary", options: { ...defaults, contextWindow: 128001, autoCondenseContext: false } },
	{ name: "floating point boundary II-08", options: { ...defaults, autoCondenseContextPercent: 16.1 } },
]
