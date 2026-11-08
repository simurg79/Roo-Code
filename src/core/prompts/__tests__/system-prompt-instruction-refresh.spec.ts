import fs from "fs/promises"
import path from "path"
import type * as vscode from "vscode"

import { SYSTEM_PROMPT } from "../system"
import type { InstructionFailureCollector } from "../sections/custom-instructions"

vi.mock("fs/promises", () => ({
	default: { stat: vi.fn(), lstat: vi.fn(), readFile: vi.fn(), readdir: vi.fn(), readlink: vi.fn() },
}))
vi.mock("vscode", () => ({
	env: { language: "en" },
	workspace: { workspaceFolders: [], getWorkspaceFolder: vi.fn(), getConfiguration: () => ({ get: vi.fn() }) },
	window: { activeTextEditor: undefined },
}))
vi.mock("../../../utils/shell", () => ({ getShell: () => "/bin/bash" }))
vi.mock("../sections/modes", () => ({ getModesSection: async () => "MODES" }))
vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: { getInstance: () => undefined },
}))
vi.mock("../../../services/roo-config", () => ({
	getRooDirectoriesForCwd: (cwd: string) => [path.join(cwd, ".roo")],
	getAllRooDirectoriesForCwd: async (cwd: string) => [path.join(cwd, ".roo")],
	getAgentsDirectoriesForCwd: async (cwd: string) => [cwd],
	getGlobalRooDirectory: () => path.resolve("global-roo"),
}))

const workspace = path.resolve("workspace")
const missing = { code: "ENOENT" }
const context = { extensionPath: "/extension", globalStorageUri: { fsPath: "/storage" } } as vscode.ExtensionContext

function build(globalInstructions: string, failures?: InstructionFailureCollector) {
	return SYSTEM_PROMPT(
		context,
		workspace,
		false,
		undefined,
		undefined,
		"code",
		undefined,
		undefined,
		globalInstructions,
		{},
		"en",
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		failures,
	)
}

function countOccurrences(text: string, fragment: string) {
	return text.split(fragment).length - 1
}

describe("SYSTEM_PROMPT instruction refresh integration", () => {
	beforeEach(() => {
		vi.resetAllMocks()
		vi.mocked(fs.stat).mockRejectedValue(missing)
		vi.mocked(fs.lstat).mockRejectedValue(missing)
		vi.mocked(fs.readdir).mockResolvedValue([])
	})

	it("fills the collector through the real loader and keeps readable legacy guidance", async () => {
		const unreadable = path.join(workspace, ".roorules")
		vi.mocked(fs.readFile).mockImplementation(async (filename) => {
			if (filename === unreadable) throw { code: "EACCES" }
			if (filename === path.join(workspace, ".clinerules")) return "legacy guidance"
			throw missing
		})
		const failures: InstructionFailureCollector = []
		const prompt = await build("saved global", failures)
		expect(prompt).toContain("legacy guidance")
		expect(prompt).toContain("saved global")
		expect(failures).toEqual([{ sourcePath: unreadable, code: "EACCES" }])
		await expect(build("saved global")).rejects.toMatchObject({ code: "EACCES" })
	})

	it("repeated refresh builds reflect saved changes without duplicating blocks", async () => {
		vi.mocked(fs.readFile).mockImplementation(async (filename) => {
			if (filename === path.join(workspace, ".roorules")) return "project rule"
			throw missing
		})
		const first = await build("old saved", [])
		const second = await build("new saved", [])
		const third = await build("new saved", [])
		expect(second).toBe(third)
		expect(countOccurrences(third, "project rule")).toBe(1)
		expect(countOccurrences(third, "new saved")).toBe(1)
		expect(third).not.toContain("old saved")
		expect(first).toContain("old saved")
		const cleared = await build("", [])
		expect(cleared).not.toContain("new saved")
	})
})
