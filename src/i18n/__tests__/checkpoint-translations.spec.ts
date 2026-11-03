import fs from "fs/promises"
import path from "path"
import { createInstance } from "i18next"

const localesDirectory = path.resolve(__dirname, "../locales")
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

interface CheckpointTranslations {
	errors: { checkpoint_restore_failed: string; checkpoint_missing: string; checkpoint_invalid: string }
	checkpoints: { restart_after_restore_failure: string; restart: string }
}

async function readTranslations(locale: string): Promise<CheckpointTranslations> {
	return JSON.parse(await fs.readFile(path.join(localesDirectory, locale, "common.json"), "utf8"))
}

describe("checkpoint translations", () => {
	it.each(locales)("renders all five checkpoint recovery strings without fallback in %s", async (locale) => {
		const translations = await readTranslations(locale)
		const english = await readTranslations("en")
		const translator = createInstance()
		await translator.init({
			lng: locale,
			fallbackLng: false,
			resources: { [locale]: { common: translations } },
			interpolation: { escapeValue: false },
		})
		const messages = [
			[
				"errors.checkpoint_restore_failed",
				translations.errors.checkpoint_restore_failed,
				english.errors.checkpoint_restore_failed,
			],
			["errors.checkpoint_missing", translations.errors.checkpoint_missing, english.errors.checkpoint_missing],
			["errors.checkpoint_invalid", translations.errors.checkpoint_invalid, english.errors.checkpoint_invalid],
			[
				"checkpoints.restart_after_restore_failure",
				translations.checkpoints.restart_after_restore_failure,
				english.checkpoints.restart_after_restore_failure,
			],
			["checkpoints.restart", translations.checkpoints.restart, english.checkpoints.restart],
		]
		for (const [key, translated, source] of messages) {
			expect(translated).toBeTruthy()
			if (locale !== "en") expect(translated).not.toBe(source)
			expect(translator.t(`common:${key}`)).toBe(translated)
		}
		expect(translations.errors.checkpoint_restore_failed).toContain("Roo")
		expect(translations.errors.checkpoint_restore_failed).toContain("{{error}}")
		expect(translations.errors.checkpoint_missing).toContain("{{commitHash}}")
		expect(translator.t("common:errors.checkpoint_restore_failed", { error: "specific failure" })).toContain(
			"specific failure",
		)
		expect(translator.t("common:errors.checkpoint_missing", { commitHash: "a".repeat(40) })).toContain(
			"a".repeat(40),
		)
	})
})
