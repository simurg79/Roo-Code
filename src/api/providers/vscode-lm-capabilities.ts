import type { LanguageModelChat } from "vscode"

export function reportedImageSupport(model: LanguageModelChat): boolean | undefined {
	const capabilities = (model as LanguageModelChat & { capabilities?: Record<string, unknown> }).capabilities
	for (const report of [capabilities?.supportsImageToText, capabilities?.imageInput]) {
		if (typeof report === "boolean") return report
	}
	return undefined
}
