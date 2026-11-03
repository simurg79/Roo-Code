import { safeWriteJson } from "../../utils/safeWriteJson"
import os from "os"
import * as path from "path"
import fs from "fs/promises"

import * as vscode from "vscode"
import { z, ZodError } from "zod"

import {
	globalSettingsSchema,
	providerSettingsWithIdSchema,
	isProviderName,
	type ProviderSettingsWithId,
	type GlobalSettings,
	type ModeConfig,
} from "@roo-code/types"

import { ProviderSettingsManager, providerProfilesSchema, type ProviderProfiles } from "./ProviderSettingsManager"
import { ContextProxy } from "./ContextProxy"
import { CustomModesManager } from "./CustomModesManager"
import { resolveDefaultSaveUri, saveLastExportPath } from "../../utils/export"
import { t } from "../../i18n"

export type ImportOptions = {
	providerSettingsManager: ProviderSettingsManager
	contextProxy: ContextProxy
	customModesManager: CustomModesManager
	provider?: {
		importSettingsFromPathAsUnit?: (filePath: string) => Promise<ImportResult>
	}
}

export type ParsedImportData = {
	providerProfiles: ProviderProfiles
	globalSettings: GlobalSettings
	warnings: string[]
}

export type ImportResult =
	| {
			success: true
			providerProfiles: ProviderProfiles
			globalSettings: GlobalSettings
			warnings?: string[]
			error?: never
	  }
	| { success: false; error: string; providerProfiles?: never; globalSettings?: never; warnings?: never }

type ExportOptions = {
	providerSettingsManager: ProviderSettingsManager
	contextProxy: ContextProxy
}
type ImportWithProviderOptions = ImportOptions & {
	provider: NonNullable<ImportOptions["provider"]> & {
		settingsImportedAt?: number
		postStateToWebview: () => Promise<void>
	}
}

/**
 * Sanitizes a provider config by resetting invalid/removed apiProvider values.
 * Returns the sanitized config and a warning message if the provider was invalid.
 */
function sanitizeProviderConfig(configName: string, apiConfig: unknown): { config: unknown; warning?: string } {
	if (typeof apiConfig !== "object" || apiConfig === null) {
		return { config: apiConfig }
	}

	const config = apiConfig as Record<string, unknown>

	// Check if apiProvider is set and if it's still valid
	if (config.apiProvider !== undefined && !isProviderName(config.apiProvider)) {
		const invalidProvider = config.apiProvider
		// Return a new config object without the invalid apiProvider
		const { apiProvider, ...restConfig } = config
		return {
			config: restConfig,
			warning: `Profile "${configName}": Invalid provider "${invalidProvider}" was removed. Please reconfigure this profile.`,
		}
	}

	return { config: apiConfig }
}

export async function parseImportFile(
	filePath: string,
): Promise<({ success: true } & ParsedImportData) | { success: false; error: string }> {
	// Use a lenient schema that accepts any apiConfigs, then validate each individually
	const lenientProviderProfilesSchema = providerProfilesSchema.extend({
		apiConfigs: z.record(z.string(), z.any()),
	})

	const lenientSchema = z.object({
		providerProfiles: lenientProviderProfilesSchema,
		globalSettings: globalSettingsSchema.optional(),
	})

	try {
		const rawData = JSON.parse(await fs.readFile(filePath, "utf-8"))
		const { providerProfiles: rawProviderProfiles, globalSettings = {} } = lenientSchema.parse(rawData)

		// Track warnings for profiles that had issues
		const warnings: string[] = []
		const validApiConfigs: Record<string, ProviderSettingsWithId> = {}

		// Process each apiConfig individually with sanitization
		for (const [configName, rawConfig] of Object.entries(rawProviderProfiles.apiConfigs)) {
			// First sanitize to handle invalid apiProvider values
			const { config: sanitizedConfig, warning } = sanitizeProviderConfig(configName, rawConfig)
			if (warning) {
				warnings.push(warning)
			}

			// Then validate the sanitized config
			const result = providerSettingsWithIdSchema.safeParse(sanitizedConfig)
			if (result.success) {
				validApiConfigs[configName] = result.data
			} else {
				// Profile is completely invalid - skip it
				const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")
				warnings.push(`Profile "${configName}" was skipped: ${issues}`)
			}
		}

		// If no valid configs were imported and there were issues, report them
		if (Object.keys(validApiConfigs).length === 0 && warnings.length > 0) {
			return {
				success: false,
				error: `No valid profiles could be imported:\n${warnings.join("\n")}`,
			}
		}

		return {
			success: true,
			providerProfiles: { ...rawProviderProfiles, apiConfigs: validApiConfigs },
			globalSettings,
			warnings,
		}
	} catch (error) {
		return importFailure(error)
	}
}

function importFailure(error: unknown): Extract<ImportResult, { success: false }> {
	if (error instanceof ZodError) {
		return {
			success: false,
			error: error.issues.map((issue) => `[${issue.path.join(".")}]: ${issue.message}`).join("\n"),
		}
	}
	return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
}

// Mode refresh and webview callbacks must never hold the profile mutation chain.
export async function importCustomModes(modes: ModeConfig[] | undefined, customModesManager: CustomModesManager) {
	await Promise.all((modes ?? []).map((mode) => customModesManager.updateCustomMode(mode.slug, mode)))
}

export async function applyImportedProfiles(
	parsed: ParsedImportData,
	{ providerSettingsManager, contextProxy }: ExportOptions,
): Promise<ImportResult> {
	// Read inside the unit so selections made during custom-mode work survive the merge.
	const previousProviderProfiles = await providerSettingsManager.export()
	const { providerProfiles: importedProfiles, globalSettings } = parsed
	const warnings = [...parsed.warnings]
	let currentApiConfigName = importedProfiles.currentApiConfigName
	const validProfileNames = Object.keys(importedProfiles.apiConfigs)
	if (!importedProfiles.apiConfigs[currentApiConfigName]) {
		if (validProfileNames.length > 0) {
			currentApiConfigName = validProfileNames[0]
			warnings.push(
				`Profile "${importedProfiles.currentApiConfigName}" was not available; defaulting to "${currentApiConfigName}".`,
			)
		} else {
			currentApiConfigName = previousProviderProfiles.currentApiConfigName
		}
	}

	const providerProfiles = {
		currentApiConfigName,
		apiConfigs: { ...previousProviderProfiles.apiConfigs, ...importedProfiles.apiConfigs },
		modeApiConfigs: { ...previousProviderProfiles.modeApiConfigs, ...importedProfiles.modeApiConfigs },
	}
	await providerSettingsManager.import(providerProfiles)
	await contextProxy.setValues(globalSettings)
	await contextProxy.setValue("currentApiConfigName", currentApiConfigName)
	const currentProvider = providerProfiles.apiConfigs[currentApiConfigName]
	if (currentProvider) {
		await contextProxy.setProviderSettings(currentProvider)
	}
	await contextProxy.setValue("listApiConfigMeta", await providerSettingsManager.listConfig())

	return { success: true, providerProfiles, globalSettings, warnings: warnings.length > 0 ? warnings : undefined }
}

export async function importSettingsFromPath(filePath: string, options: ImportOptions): Promise<ImportResult> {
	if (options.provider?.importSettingsFromPathAsUnit) {
		try {
			return await options.provider.importSettingsFromPathAsUnit(filePath)
		} catch (error) {
			return importFailure(error)
		}
	}
	const parsed = await parseImportFile(filePath)
	if (!parsed.success) {
		return parsed
	}
	try {
		await importCustomModes(parsed.globalSettings.customModes, options.customModesManager)
		return await applyImportedProfiles(parsed, options)
	} catch (error) {
		return importFailure(error)
	}
}

/**
 * Import settings from a file using a file dialog
 * @param options - Import options containing managers and proxy
 * @returns Promise resolving to import result
 */
export const importSettings = async (options: ImportOptions): Promise<ImportResult> => {
	const { contextProxy } = options
	// Use the last export path as a sensible default, falling back to Downloads
	const defaultUri = resolveDefaultSaveUri(contextProxy, "lastSettingsExportPath", "roo-code-settings.json", {
		useWorkspace: false,
		fallbackDir: path.join(os.homedir(), "Downloads"),
	})

	const uris = await vscode.window.showOpenDialog({
		filters: { JSON: ["json"] },
		canSelectMany: false,
		defaultUri,
	})

	if (!uris) {
		return { success: false, error: "User cancelled file selection" }
	}

	return importSettingsFromPath(uris[0].fsPath, options)
}

/**
 * Import settings from a specific file
 * @param options - Import options containing managers and proxy
 * @param fileUri - URI of the file to import from
 * @returns Promise resolving to import result
 */
export const importSettingsFromFile = async (options: ImportOptions, fileUri: vscode.Uri) => {
	return importSettingsFromPath(fileUri.fsPath, options)
}

export const exportSettings = async ({ providerSettingsManager, contextProxy }: ExportOptions) => {
	const defaultUri = await resolveDefaultSaveUri(contextProxy, "lastSettingsExportPath", "roo-code-settings.json", {
		useWorkspace: false,
		fallbackDir: path.join(os.homedir(), "Downloads"),
	})

	const uri = await vscode.window.showSaveDialog({
		filters: { JSON: ["json"] },
		defaultUri,
	})

	if (!uri) {
		return
	}

	await saveLastExportPath(contextProxy, "lastSettingsExportPath", uri)

	try {
		const providerProfiles = await providerSettingsManager.export()
		const globalSettings = await contextProxy.export()

		// It's okay if there are no global settings, but if there are no
		// provider profile configured then don't export. If we wanted to
		// support this case then the `importSettings` function would need to
		// be updated to handle the case where there are no provider profiles.
		if (typeof providerProfiles === "undefined") {
			return
		}

		// OpenAI Compatible settings are now correctly stored in codebaseIndexConfig
		// No workaround needed - they will be exported automatically with the config

		await safeWriteJson(uri.fsPath, { providerProfiles, globalSettings })
	} catch (e) {
		console.error("Failed to export settings:", e)
		// Don't re-throw - the UI will handle showing error messages
	}
}

/**
 * Import settings with complete UI feedback and provider state updates
 * @param options - Import options with provider instance
 * @param filePath - Optional file path to import from. If not provided, a file dialog will be shown.
 * @returns Promise that resolves when import is complete
 */
export const importSettingsWithFeedback = async (
	{ providerSettingsManager, contextProxy, customModesManager, provider }: ImportWithProviderOptions,
	filePath?: string,
) => {
	let result

	if (filePath) {
		// Validate file path and check if file exists
		try {
			// Check if file exists and is readable
			await fs.access(filePath, fs.constants.F_OK | fs.constants.R_OK)
			result = await importSettingsFromPath(filePath, {
				providerSettingsManager,
				contextProxy,
				customModesManager,
				provider,
			})
		} catch (error) {
			result = {
				success: false,
				error: `Cannot access file at path "${filePath}": ${error instanceof Error ? error.message : "Unknown error"}`,
			}
		}
	} else {
		result = await importSettings({ providerSettingsManager, contextProxy, customModesManager, provider })
	}

	if (result.success) {
		provider.settingsImportedAt = Date.now()
		await provider.postStateToWebview()

		// Show warnings if any profiles had issues but were still imported (with modifications)
		if (result.warnings && result.warnings.length > 0) {
			// Log full details to the console for debugging
			console.warn("Settings import completed with warnings:", result.warnings)

			// Show a short summary in the toast notification
			const count = result.warnings.length
			const summary =
				count === 1 ? `1 profile had issues during import.` : `${count} profiles had issues during import.`
			await vscode.window.showWarningMessage(
				`${t("common:info.settings_imported")} ${summary} See Developer Tools console for details.`,
			)
		} else {
			await vscode.window.showInformationMessage(t("common:info.settings_imported"))
		}
	} else if (result.error) {
		await vscode.window.showErrorMessage(t("common:errors.settings_import_failed", { error: result.error }))
	}
}
