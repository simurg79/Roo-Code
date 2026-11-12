import fs from "fs/promises"
import path from "path"
import { createInstance } from "i18next"
import { formatProviderWaitMessage } from "../provider-wait-message"
import { t } from "../../../../i18n"

vi.mock("../../../../i18n", () => ({ t: vi.fn() }))

const locales = [
	"ca",
	"de",
	"en",
	"es",
	"fr",
	"hi",
	"id",
	"it",
	"ja",
	"ko",
	"nl",
	"pl",
	"pt-BR",
	"ru",
	"tr",
	"vi",
	"zh-CN",
	"zh-TW",
]

it.each(locales)("formats both provider waits and the search error without fallback in %s", async (locale) => {
	const messages = JSON.parse(
		await fs.readFile(path.resolve(__dirname, "../../../../i18n/locales", locale, "embeddings.json"), "utf8"),
	)
	const translator = createInstance()
	await translator.init({
		lng: locale,
		fallbackLng: false,
		resources: { [locale]: { embeddings: messages } },
		interpolation: { escapeValue: false },
	})
	vi.mocked(t).mockImplementation((key, options) => translator.t(key, options))
	const time = "2026-11-11T12:02:00.000Z"
	const result = formatProviderWaitMessage([
		{ service: "openai", resumeAt: Date.parse(time), waitingFiles: [] },
		{ service: "qdrant", waitingFiles: [] },
	])
	expect(result.split("\n")).toEqual([
		translator.t("embeddings:orchestrator.providerWaitingUntil", { service: "openai", time }),
		translator.t("embeddings:orchestrator.providerWaiting", { service: "qdrant" }),
	])
	expect(result).toContain("openai")
	expect(result).toContain("qdrant")
	expect(result).toContain(time)
	expect(result).not.toContain("{{")
	expect(result).not.toContain("embeddings:")
	expect(messages.orchestrator.providerWaiting).toContain("{{service}}")
	expect(messages.orchestrator.providerWaitingUntil).toContain("{{time}}")
	expect(translator.t("embeddings:searchProviderRateLimited")).toBe(messages.searchProviderRateLimited)
	expect(messages.searchProviderRateLimited).toBeTruthy()
	if (locale !== "en") {
		expect(messages.orchestrator.providerWaiting).not.toBe(
			"Waiting for {{service}}; indexing resumes automatically",
		)
		expect(messages.searchProviderRateLimited).not.toContain("Search provider rate-limited")
	}
})

it("returns no message when no provider waits remain", () => {
	expect(formatProviderWaitMessage([])).toBe("")
})
