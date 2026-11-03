import fs from "fs/promises"
import * as vscode from "vscode"
import { ZodError } from "zod"

import {
	applyImportedProfiles,
	importCustomModes,
	importSettings,
	importSettingsFromFile,
	importSettingsFromPath,
	importSettingsWithFeedback,
	parseImportFile,
	type ImportOptions,
	type ImportResult,
} from "../importExport"
import { CustomModesManager } from "../CustomModesManager"
import type { ProviderProfiles } from "../ProviderSettingsManager"

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
		access: vi.fn(),
		constants: { F_OK: 0, R_OK: 4 },
	},
}))
vi.mock("vscode", () => ({
	window: {
		showOpenDialog: vi.fn(),
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
	},
	Uri: { file: (filePath: string) => ({ fsPath: filePath }) },
}))
vi.mock("../../../utils/export", () => ({ resolveDefaultSaveUri: vi.fn() }))
vi.mock("../../../api", () => ({ buildApiHandler: vi.fn() }))

function deferred<Value = void>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void
	const promise = new Promise<Value>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

const importedProfile = { apiProvider: "openai" as const, id: "imported-id" }
const customMode = { slug: "imported-mode", name: "Imported mode", roleDefinition: "Imported role", groups: [] }
const importFile = {
	providerProfiles: {
		currentApiConfigName: "imported",
		apiConfigs: { imported: importedProfile },
		modeApiConfigs: { code: "imported-id" },
	},
	globalSettings: { mode: "code", customModes: [customMode] },
}

function createOptions() {
	const providerSettingsManager = {
		export: vi.fn().mockResolvedValue({
			currentApiConfigName: "previous",
			apiConfigs: { previous: { apiProvider: "anthropic", id: "previous-id" } },
			modeApiConfigs: { ask: "previous-id" },
		}),
		import: vi.fn().mockResolvedValue(undefined),
		listConfig: vi.fn().mockResolvedValue([{ name: "imported", id: "imported-id" }]),
	}
	const contextProxy = {
		setValues: vi.fn().mockResolvedValue(undefined),
		setValue: vi.fn().mockResolvedValue(undefined),
		setProviderSettings: vi.fn().mockResolvedValue(undefined),
	}
	const customModesManager = { updateCustomMode: vi.fn().mockResolvedValue(undefined) }
	const options = { providerSettingsManager, contextProxy, customModesManager } as unknown as ImportOptions
	return { options, providerSettingsManager, contextProxy, customModesManager }
}

// The parent owns the real provider chain; this harness pins the import phase boundary only.
function createPhaseProvider(options: ImportOptions) {
	let chain = Promise.resolve()
	const runUnit = <Value>(mutation: () => Promise<Value>) => {
		const result = chain.then(mutation)
		chain = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
	const provider = {
		settingsImportedAt: 0,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		importSettingsFromPathAsUnit: vi.fn(async (filePath: string): Promise<ImportResult> => {
			const parsed = await parseImportFile(filePath)
			if (!parsed.success) {
				return parsed
			}
			try {
				await importCustomModes(parsed.globalSettings.customModes, options.customModesManager)
				return await runUnit(() => applyImportedProfiles(parsed, options))
			} catch (error) {
				return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
			}
		}),
	}
	return { provider, runUnit }
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(importFile))
	vi.mocked(fs.access).mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

describe("import phase contracts", () => {
	it("parses without manager reads or writes and merges profiles only at application", async () => {
		const { options, providerSettingsManager, contextProxy, customModesManager } = createOptions()
		const parsed = await parseImportFile("settings.json")
		expect(parsed.success).toBe(true)
		expect(providerSettingsManager.export).not.toHaveBeenCalled()
		expect(providerSettingsManager.import).not.toHaveBeenCalled()
		expect(contextProxy.setValues).not.toHaveBeenCalled()
		expect(customModesManager.updateCustomMode).not.toHaveBeenCalled()
		if (!parsed.success) {
			throw new Error(parsed.error)
		}
		providerSettingsManager.export.mockResolvedValue({
			currentApiConfigName: "later",
			apiConfigs: { later: { apiProvider: "anthropic", id: "later-id" } },
			modeApiConfigs: { ask: "later-id" },
		})
		const result = await applyImportedProfiles(parsed, options)
		expect(result).toEqual({
			success: true,
			providerProfiles: {
				currentApiConfigName: "imported",
				apiConfigs: { later: { apiProvider: "anthropic", id: "later-id" }, imported: importedProfile },
				modeApiConfigs: { ask: "later-id", code: "imported-id" },
			},
			globalSettings: importFile.globalSettings,
			warnings: undefined,
		})
		expect(customModesManager.updateCustomMode).not.toHaveBeenCalled()
	})

	it.each(["setValues", "currentApiConfigName", "setProviderSettings", "listConfig", "listApiConfigMeta"])(
		"awaits %s before settling the import unit or starting a later unit",
		async (heldWrite) => {
			const { options, providerSettingsManager, contextProxy } = createOptions()
			const writeStarted = deferred()
			const writeRelease = deferred()
			const holdWrite = async () => {
				writeStarted.resolve()
				await writeRelease.promise
			}
			if (heldWrite === "setValues") {
				contextProxy.setValues.mockImplementation(holdWrite)
			} else if (heldWrite === "setProviderSettings") {
				contextProxy.setProviderSettings.mockImplementation(holdWrite)
			} else if (heldWrite === "listConfig") {
				providerSettingsManager.listConfig.mockImplementation(async () => {
					await holdWrite()
					return [{ name: "imported", id: "imported-id" }]
				})
			} else {
				contextProxy.setValue.mockImplementation(async (key: string) => {
					if (key === heldWrite) {
						await holdWrite()
					}
				})
			}
			const { provider, runUnit } = createPhaseProvider(options)
			const importPromise = importSettingsWithFeedback({ ...options, provider }, "settings.json")
			await writeStarted.promise
			const laterMutation = vi.fn().mockResolvedValue(undefined)
			const laterUnit = runUnit(laterMutation)
			await Promise.resolve()
			expect(laterMutation).not.toHaveBeenCalled()
			expect(provider.settingsImportedAt).toBe(0)
			expect(provider.postStateToWebview).not.toHaveBeenCalled()
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
			writeRelease.resolve()
			await Promise.all([importPromise, laterUnit])
			expect(laterMutation).toHaveBeenCalledOnce()
			expect(contextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "imported")
			expect(contextProxy.setProviderSettings).toHaveBeenCalledWith(importedProfile)
			expect(contextProxy.setValue).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "imported", id: "imported-id" },
			])
			expect(provider.postStateToWebview).toHaveBeenCalledOnce()
			expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce()
		},
	)

	it.each([false, true])(
		"preserves validation failure formatting from profile application (provider: %s)",
		async (withProvider) => {
			const { options, providerSettingsManager } = createOptions()
			const failure = new ZodError([
				{ code: "custom", path: ["apiConfigs", "imported"], message: "Rejected profile" },
			])
			providerSettingsManager.import.mockRejectedValue(failure)
			const provider = { importSettingsFromPathAsUnit: vi.fn().mockRejectedValue(failure) }
			expect(
				await importSettingsFromPath("settings.json", withProvider ? { ...options, provider } : options),
			).toEqual({
				success: false,
				error: "[apiConfigs.imported]: Rejected profile",
			})
		},
	)

	it("returns the existing failure payload without applying any phase after parse failure", async () => {
		const { options, providerSettingsManager, customModesManager } = createOptions()
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ providerProfiles: { apiConfigs: {} } }))
		expect(await importSettingsFromPath("settings.json", options)).toEqual({
			success: false,
			error: "[providerProfiles.currentApiConfigName]: Required",
		})
		expect(customModesManager.updateCustomMode).not.toHaveBeenCalled()
		expect(providerSettingsManager.export).not.toHaveBeenCalled()
	})

	it.each(["path", "dialog", "file", "feedback path", "feedback dialog"])(
		"routes the %s entrypoint through the provider method with its receiver intact",
		async (entrypoint) => {
			const { options, providerSettingsManager } = createOptions()
			const expectedResult: ImportResult = {
				success: true,
				providerProfiles: importFile.providerProfiles as ProviderProfiles,
				globalSettings: {},
			}
			const provider = {
				postStateToWebview: vi.fn().mockResolvedValue(undefined),
				importSettingsFromPathAsUnit: vi.fn(async function (this: unknown, filePath: string) {
					expect(this).toBe(provider)
					expect(filePath).toBe("settings.json")
					return expectedResult
				}),
			}
			vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([vscode.Uri.file("settings.json")])
			const providerOptions = { ...options, provider }
			if (entrypoint === "path") {
				expect(await importSettingsFromPath("settings.json", providerOptions)).toBe(expectedResult)
			} else if (entrypoint === "dialog") {
				expect(await importSettings(providerOptions)).toBe(expectedResult)
			} else if (entrypoint === "file") {
				expect(await importSettingsFromFile(providerOptions, vscode.Uri.file("settings.json"))).toBe(
					expectedResult,
				)
			} else {
				await importSettingsWithFeedback(
					providerOptions,
					entrypoint === "feedback path" ? "settings.json" : undefined,
				)
			}
			expect(provider.importSettingsFromPathAsUnit).toHaveBeenCalledOnce()
			expect(fs.readFile).not.toHaveBeenCalled()
			expect(providerSettingsManager.export).not.toHaveBeenCalled()
		},
	)
})

describe("CR-27 import waits outside the profile unit", () => {
	it("leaves the file dialog outside the unit", async () => {
		const { options, providerSettingsManager } = createOptions()
		const { provider, runUnit } = createPhaseProvider(options)
		const dialogRelease = deferred<vscode.Uri[]>()
		vi.mocked(vscode.window.showOpenDialog).mockReturnValue(dialogRelease.promise)
		const importPromise = importSettings({ ...options, provider })
		const laterMutation = vi.fn().mockResolvedValue(undefined)
		await runUnit(laterMutation)
		expect(laterMutation).toHaveBeenCalledOnce()
		expect(providerSettingsManager.import).not.toHaveBeenCalled()
		dialogRelease.resolve([vscode.Uri.file("settings.json")])
		expect((await importPromise).success).toBe(true)
	})

	it.each(["refresh", "webview post"])("does not hold a unit during custom-mode %s", async (heldPhase) => {
		const { options, providerSettingsManager } = createOptions()
		const modeManager = Object.create(CustomModesManager.prototype) as CustomModesManager
		const modeInternals = modeManager as unknown as {
			queueWrite: (operation: () => Promise<void>) => Promise<void>
			getCustomModesFilePath: () => Promise<string>
			updateModesInFile: () => Promise<void>
			clearCache: () => void
			refreshMergedState: () => Promise<void>
			getWorkspaceRoomodes: () => Promise<undefined>
			loadModesFromFile: () => Promise<unknown[]>
			mergeCustomModes: () => Promise<unknown[]>
			context: { globalState: { update: () => Promise<void> } }
			onUpdate: () => Promise<void>
		}
		const heldStarted = deferred()
		const heldRelease = deferred()
		const holdPhase = async () => {
			heldStarted.resolve()
			await heldRelease.promise
		}
		vi.spyOn(modeInternals, "queueWrite").mockImplementation((operation) => operation())
		vi.spyOn(modeInternals, "getCustomModesFilePath").mockResolvedValue("custom_modes.yaml")
		const modeWrite = vi.spyOn(modeInternals, "updateModesInFile").mockResolvedValue(undefined)
		vi.spyOn(modeInternals, "clearCache").mockImplementation(() => {})
		vi.spyOn(modeInternals, "getWorkspaceRoomodes").mockResolvedValue(undefined)
		vi.spyOn(modeInternals, "loadModesFromFile").mockResolvedValue([])
		vi.spyOn(modeInternals, "mergeCustomModes").mockResolvedValue([])
		modeInternals.context = { globalState: { update: vi.fn().mockResolvedValue(undefined) } }
		modeInternals.onUpdate = heldPhase === "webview post" ? holdPhase : vi.fn().mockResolvedValue(undefined)
		if (heldPhase === "refresh") {
			vi.spyOn(modeInternals, "refreshMergedState").mockImplementation(holdPhase)
		}
		options.customModesManager = modeManager
		const { provider, runUnit } = createPhaseProvider(options)
		const importPromise = importSettingsFromPath("settings.json", { ...options, provider })
		await heldStarted.promise
		expect(modeWrite).toHaveBeenCalledOnce()
		const laterMutation = vi.fn().mockResolvedValue(undefined)
		await runUnit(laterMutation)
		expect(laterMutation).toHaveBeenCalledOnce()
		expect(providerSettingsManager.export).not.toHaveBeenCalled()
		expect(providerSettingsManager.import).not.toHaveBeenCalled()
		heldRelease.resolve()
		expect((await importPromise).success).toBe(true)
		expect(modeWrite).toHaveBeenCalledOnce()
		expect(providerSettingsManager.import).toHaveBeenCalledOnce()
	})

	it.each([false, true])(
		"custom-mode failure prevents profile writes without rolling back an already-written mode (provider: %s)",
		async (withProvider) => {
			const { options, providerSettingsManager, contextProxy, customModesManager } = createOptions()
			const writtenModes: string[] = []
			customModesManager.updateCustomMode.mockImplementation(async (slug: string) => {
				if (slug === "failed-mode") {
					throw new Error("Custom mode refresh failed")
				}
				writtenModes.push(slug)
			})
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					...importFile,
					globalSettings: { customModes: [customMode, { ...customMode, slug: "failed-mode" }] },
				}),
			)
			const { provider, runUnit } = createPhaseProvider(options)
			const result = await importSettingsFromPath(
				"settings.json",
				withProvider ? { ...options, provider } : options,
			)
			expect(result).toEqual({ success: false, error: "Custom mode refresh failed" })
			const laterMutation = vi.fn().mockResolvedValue(undefined)
			await runUnit(laterMutation)
			expect(laterMutation).toHaveBeenCalledOnce()
			expect(writtenModes).toEqual(["imported-mode"])
			expect(customModesManager.updateCustomMode).toHaveBeenCalledTimes(2)
			expect(providerSettingsManager.export).not.toHaveBeenCalled()
			expect(providerSettingsManager.import).not.toHaveBeenCalled()
			expect(contextProxy.setValues).not.toHaveBeenCalled()
			expect(contextProxy.setValue).not.toHaveBeenCalled()
			expect(contextProxy.setProviderSettings).not.toHaveBeenCalled()
		},
	)
})
