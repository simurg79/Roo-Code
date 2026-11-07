import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { performance } from "perf_hooks"
import ignore from "ignore"
import * as vscode from "vscode"
import { Package } from "../../../shared/package"
import {
	createDiscoveryContext,
	discoveryRelativePath,
	getDiscoveryOptions,
	getIncludedRoot,
	isDiscoveryPathAllowed,
	isIncludedRootGitEligible,
	isUnderRoot,
	readRooInclude,
	setDiscoveryOutputChannel,
	toIndexPath,
	type DiscoveryContext,
	type IncludedRoot,
} from "../discovery-options"

vi.mock("vscode", () => ({ workspace: { getConfiguration: vi.fn() } }))
vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>()
	return { ...actual, realpathSync: vi.fn(actual.realpathSync) }
})

let fixture: string
let workspace: string
let outside: string
let context: DiscoveryContext
let appendLine: ReturnType<typeof vi.fn>

const defaults = { respectGitignore: true, followSymlinks: false }

beforeEach(async () => {
	vi.restoreAllMocks()
	fixture = await fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-discovery-options-"))
	workspace = path.join(fixture, "workspace")
	outside = path.join(fixture, "outside")
	await fs.promises.mkdir(workspace)
	await fs.promises.mkdir(outside)
	context = {
		workspaceRoot: workspace,
		options: { ...defaults },
		rooIgnore: ignore(),
		includedRoots: [{ root: outside, ignoreBase: outside, gitignore: ignore() }],
	}
	appendLine = vi.fn()
	setDiscoveryOutputChannel({ appendLine } as unknown as vscode.OutputChannel)
	vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
		get: vi.fn((_key: string, fallback: boolean) => fallback),
	} as unknown as vscode.WorkspaceConfiguration)
})

afterEach(async () => {
	vi.restoreAllMocks()
	setDiscoveryOutputChannel({ appendLine: () => undefined } as unknown as vscode.OutputChannel)
	await fs.promises.rm(fixture, { recursive: true, force: true })
	expect(fs.existsSync(fixture)).toBe(false)
})

async function directory(root: string, relativePath: string): Promise<string> {
	const absolutePath = path.join(root, relativePath)
	await fs.promises.mkdir(absolutePath, { recursive: true })
	return absolutePath
}

async function writeInclude(content: string): Promise<void> {
	await fs.promises.writeFile(path.join(workspace, ".rooInclude"), content)
}

function denyRead(target: string): void {
	const readFile = fs.promises.readFile.bind(fs.promises)
	vi.spyOn(fs.promises, "readFile").mockImplementation((...arguments_) => {
		if (String(arguments_[0]) === target) {
			return Promise.reject(Object.assign(new Error("permission\r\ndenied"), { code: "EACCES" }))
		}
		return readFile(...arguments_)
	})
}

describe("getDiscoveryOptions", () => {
	it("reads the shared section and explicit default flags", () => {
		expect(getDiscoveryOptions()).toEqual(defaults)
		expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(Package.name)
		const configuration = vi.mocked(vscode.workspace.getConfiguration).mock.results[0].value
		expect(configuration.get.mock.calls).toEqual([
			["discovery.respectGitignore", true],
			["discovery.followSymlinks", false],
		])
	})

	it.each([
		[true, true],
		[false, false],
		[false, true],
	])("keeps independent configured flags: respect=%s follow=%s", (respectGitignore, followSymlinks) => {
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: (key: string) => (key === "discovery.respectGitignore" ? respectGitignore : followSymlinks),
		} as vscode.WorkspaceConfiguration)
		expect(getDiscoveryOptions()).toEqual({ respectGitignore, followSymlinks })
	})

	it("does not hide configuration failures", () => {
		vi.mocked(vscode.workspace.getConfiguration).mockImplementation(() => {
			throw new Error("configuration unavailable")
		})
		expect(getDiscoveryOptions).toThrow("configuration unavailable")
	})
})

describe("readRooInclude (D3)", () => {
	it("parses CRLF, whitespace, comments, absolute and relative folders, deduplicating resolved paths", async () => {
		const hidden = await directory(workspace, ".roo")
		const spaced = await directory(workspace, "folder with spaces")
		const literal = await directory(workspace, "!literal#folder")
		await writeInclude(
			`\r\n # comment\r\n .roo \r\n${hidden}\r\n./.roo/../.roo\r\n${outside}\r\nfolder with spaces\r\n!literal#folder\r\n`,
		)
		const roots = await readRooInclude(workspace)
		expect(roots.map(({ root, ignoreBase }) => [root, ignoreBase])).toEqual(
			[hidden, outside, spaced, literal].map((root) => [root, root]),
		)
		expect(roots.every(({ gitignore }) => !gitignore.ignores("visible.ts"))).toBe(true)
		expect(appendLine).not.toHaveBeenCalled()
	})

	it("uses only the selected workspace's include file", async () => {
		await writeInclude(outside)
		const otherWorkspace = await directory(fixture, "other-workspace")
		expect(await readRooInclude(otherWorkspace)).toEqual([])
		expect((await readRooInclude(workspace)).map(({ root }) => root)).toEqual([outside])
	})

	it("treats a missing include file as no inclusions without warning", async () => {
		expect(await readRooInclude(workspace)).toEqual([])
		expect(appendLine).not.toHaveBeenCalled()
	})

	it("warns once for an unreadable include file, keeping the warning on one line", async () => {
		const includePath = path.join(workspace, ".rooInclude")
		denyRead(includePath)
		expect(await readRooInclude(workspace)).toEqual([])
		expect(appendLine).toHaveBeenCalledExactlyOnceWith(
			`[Discovery] Skipping ${includePath}: Error: permission  denied`,
		)
	})

	it("warns once per invalid resolved entry and continues with valid folders", async () => {
		const valid = await directory(workspace, "valid")
		const unreadable = path.join(workspace, "unreadable")
		await fs.promises.writeFile(path.join(workspace, "file.txt"), "not a directory")
		const stat = fs.promises.stat.bind(fs.promises)
		vi.spyOn(fs.promises, "stat").mockImplementation((...arguments_) => {
			if (String(arguments_[0]) === unreadable) {
				return Promise.reject(Object.assign(new Error("folder unreadable"), { code: "EACCES" }))
			}
			return stat(...arguments_)
		})
		await writeInclude("missing\n./missing\nfile.txt\nunreadable\nvalid\n")
		expect((await readRooInclude(workspace)).map(({ root }) => root)).toEqual([valid])
		expect(appendLine).toHaveBeenCalledTimes(3)
		expect(appendLine.mock.calls.map(([message]) => message)).toEqual([
			expect.stringContaining("Skipping missing:"),
			"[Discovery] Skipping file.txt: not a directory",
			"[Discovery] Skipping unreadable: Error: folder unreadable",
		])
	})

	it("skips a blocked workspace folder with one warning while preserving allowed entries", async () => {
		await directory(workspace, "secret")
		const allowed = await directory(workspace, "allowed")
		context.rooIgnore.add("secret/")
		await writeInclude("secret\n./secret\nallowed")
		expect((await readRooInclude(workspace, context)).map(({ root }) => root)).toEqual([allowed])
		expect(appendLine).toHaveBeenCalledExactlyOnceWith("[Discovery] Skipping secret: blocked by .rooignore")
	})

	it("rejects an outside included alias whose real folder is blocked inside the workspace", async () => {
		const secret = await directory(workspace, "secret")
		const alias = path.join(fixture, "alias")
		await fs.promises.symlink(secret, alias, "junction")
		context.rooIgnore.add("secret/")
		await writeInclude(alias)
		expect(await readRooInclude(workspace, context)).toEqual([])
		expect(appendLine).toHaveBeenCalledExactlyOnceWith(`[Discovery] Skipping ${alias}: blocked by .rooignore`)
	})

	it.each([false, true])(
		"accepts a linked included root independently of followSymlinks=%s",
		async (followSymlinks) => {
			const alias = path.join(workspace, ".linked")
			await fs.promises.symlink(outside, alias, "junction")
			context.options.followSymlinks = followSymlinks
			await writeInclude(".linked")
			expect((await readRooInclude(workspace, context)).map(({ root }) => root)).toEqual([alias])
			expect(appendLine).not.toHaveBeenCalled()
		},
	)
})

describe("isDiscoveryPathAllowed (D9)", () => {
	it.each([undefined, ""])("skips realpath with known-empty Roo rules (%s)", async (content) => {
		context = await createDiscoveryContext(workspace, defaults, content)
		expect(context.includedRoots).toEqual([])
		const realpath = vi.mocked(fs.realpathSync).mockClear()
		const asyncRealpath = vi.spyOn(fs.promises, "realpath")
		const visible = path.join(workspace, "visible.ts")
		await fs.promises.writeFile(visible, "content")
		expect(isDiscoveryPathAllowed(visible, context)).toBe(true)
		expect(realpath).not.toHaveBeenCalled()
		expect(asyncRealpath).not.toHaveBeenCalled()
		for (const options of [
			{ respectGitignore: false, followSymlinks: false },
			{ respectGitignore: true, followSymlinks: true },
		]) {
			context.options = options
			expect(isDiscoveryPathAllowed(visible, context)).toBe(true)
		}
		expect(realpath).not.toHaveBeenCalled()
	})

	it.each([false, true])("applies Roo restrictions independently of respectGitignore=%s", (respectGitignore) => {
		context.options.respectGitignore = respectGitignore
		context.rooIgnore.add("secret/\n**/*.pem")
		expect(isDiscoveryPathAllowed(path.join(workspace, "visible.ts"), context)).toBe(true)
		expect(isDiscoveryPathAllowed(path.join(workspace, "secret", "file.ts"), context)).toBe(false)
		expect(isDiscoveryPathAllowed(path.join(workspace, "nested", "key.pem"), context)).toBe(false)
	})

	it.each(["alias/", "secret/"])(
		"checks default workspace alias and real paths without inclusions against %s",
		async (rule) => {
			context.includedRoots = []
			const secret = await directory(workspace, "secret")
			await fs.promises.writeFile(path.join(secret, "file.ts"), "content")
			const alias = path.join(workspace, "alias")
			await fs.promises.symlink(secret, alias, "junction")
			context.rooIgnore.add(rule)
			const realpath = vi.mocked(fs.realpathSync).mockClear()
			expect(isDiscoveryPathAllowed(path.join(alias, "file.ts"), context)).toBe(false)
			expect(realpath).toHaveBeenCalledTimes(rule === "secret/" ? 1 : 0)
		},
	)

	it("allows an unblocked workspace alias and real workspace path", async () => {
		const target = await directory(workspace, "target")
		await fs.promises.writeFile(path.join(target, "file.ts"), "content")
		const alias = path.join(workspace, "alias")
		await fs.promises.symlink(target, alias, "junction")
		expect(isDiscoveryPathAllowed(path.join(alias, "file.ts"), context)).toBe(true)
	})

	it("matches outside included paths relative to their root, never sending parent segments to the matcher", () => {
		context.rooIgnore.add("/secret/\n**/*.pem")
		const matcher = vi.spyOn(context.rooIgnore, "ignores")
		expect(isDiscoveryPathAllowed(path.join(outside, "secret", "file.ts"), context)).toBe(false)
		expect(isDiscoveryPathAllowed(path.join(outside, "nested", "key.pem"), context)).toBe(false)
		expect(isDiscoveryPathAllowed(path.join(outside, "visible.ts"), context)).toBe(true)
		expect(matcher.mock.calls.map(([candidate]) => candidate)).toEqual([
			"secret/file.ts",
			"nested/key.pem",
			"visible.ts",
		])
	})

	it("also checks an included alias's real path when it is inside the workspace", async () => {
		const target = await directory(workspace, "secret")
		await fs.promises.writeFile(path.join(target, "file.ts"), "content")
		const alias = path.join(outside, "alias")
		await fs.promises.symlink(target, alias, "junction")
		context.rooIgnore.add("/secret/")
		expect(isDiscoveryPathAllowed(path.join(alias, "file.ts"), context)).toBe(false)
	})

	it("uses only the workspace alias rules for real paths outside every root", async () => {
		const target = await directory(fixture, "unlisted-secret")
		await fs.promises.writeFile(path.join(target, "file.ts"), "content")
		const alias = path.join(workspace, "alias")
		await fs.promises.symlink(target, alias, "junction")
		context.rooIgnore.add("unlisted-secret/")
		expect(isDiscoveryPathAllowed(path.join(alias, "file.ts"), context)).toBe(true)
		context.rooIgnore.add("alias/")
		expect(isDiscoveryPathAllowed(path.join(alias, "file.ts"), context)).toBe(false)
		expect(isDiscoveryPathAllowed(path.join(target, "file.ts"), context)).toBe(false)
	})

	it("uses only root-relative alias rules for an included link targeting another outside folder", async () => {
		const target = await directory(fixture, "unlisted-secret")
		await fs.promises.writeFile(path.join(target, "file.ts"), "content")
		const alias = path.join(outside, "alias")
		await fs.promises.symlink(target, alias, "junction")
		context.rooIgnore.add("unlisted-secret/")
		expect(isDiscoveryPathAllowed(path.join(alias, "file.ts"), context)).toBe(true)
		context.rooIgnore.add("alias/")
		expect(isDiscoveryPathAllowed(path.join(alias, "file.ts"), context)).toBe(false)
	})

	it.each(["/", path.sep])("keeps directory markers for folder-only rules with suffix %s", (suffix) => {
		context.rooIgnore.add("secret/")
		for (const root of [workspace, outside]) {
			expect(isDiscoveryPathAllowed(`${path.join(root, "secret")}${suffix}`, context)).toBe(false)
			expect(isDiscoveryPathAllowed(path.join(root, "secret"), context)).toBe(true)
		}
	})

	it("allows each root itself without inventing a name for its empty relative path", () => {
		context.rooIgnore.add("workspace/\noutside/")
		expect(isDiscoveryPathAllowed(`${workspace}/`, context)).toBe(true)
		expect(isDiscoveryPathAllowed(`${outside}/`, context)).toBe(true)
	})

	it("fails closed on an alias matcher error", () => {
		vi.spyOn(context.rooIgnore, "ignores").mockImplementation(() => {
			throw new RangeError("invalid match")
		})
		expect(isDiscoveryPathAllowed(path.join(workspace, "file.ts"), context)).toBe(false)
	})

	it("fails closed on a real-path matcher error", async () => {
		const target = await directory(workspace, "target")
		await fs.promises.writeFile(path.join(target, "file.ts"), "content")
		const alias = path.join(workspace, "alias")
		await fs.promises.symlink(target, alias, "junction")
		vi.spyOn(context.rooIgnore, "ignores")
			.mockReturnValueOnce(false)
			.mockImplementation(() => {
				throw new Error("real-path match failed")
			})
		expect(isDiscoveryPathAllowed(path.join(alias, "file.ts"), context)).toBe(false)
	})

	it("still checks alias rules when a real path is unavailable, including watcher deletions", () => {
		context.rooIgnore.add("blocked.ts")
		expect(isDiscoveryPathAllowed(path.join(workspace, "deleted.ts"), context)).toBe(true)
		expect(isDiscoveryPathAllowed(path.join(workspace, "blocked.ts"), context)).toBe(false)
	})
})

describe("included-root Git eligibility (D10)", () => {
	it.each([false, true])(
		"filters both files and folder entries with respectGitignore=%s",
		async (respectGitignore) => {
			await fs.promises.writeFile(path.join(outside, ".gitignore"), "/blocked/\n*.log\n!keep.log\n")
			await writeInclude(outside)
			const [root] = await readRooInclude(workspace)
			const options = { ...defaults, respectGitignore }
			for (const relativePath of ["error.log", "blocked/", "blocked/file.ts"]) {
				expect(isIncludedRootGitEligible(path.join(outside, relativePath), root, options)).toBe(
					!respectGitignore,
				)
			}
			for (const relativePath of ["visible.ts", "keep.log", "allowed/"]) {
				expect(isIncludedRootGitEligible(path.join(outside, relativePath), root, options)).toBe(true)
			}
			expect(isIncludedRootGitEligible(`${outside}/`, root, options)).toBe(true)
		},
	)

	it.each(["/", path.sep])("recognizes directory suffix %s as a folder marker", (suffix) => {
		const root = context.includedRoots[0]
		root.gitignore.add("blocked/")
		expect(isIncludedRootGitEligible(`${path.join(outside, "blocked")}${suffix}`, root, defaults)).toBe(false)
	})

	it("reads only the included root's top-level Git rules", async () => {
		await fs.promises.writeFile(path.join(workspace, ".gitignore"), "workspace-only.ts\n")
		const nested = await directory(outside, "nested")
		await fs.promises.writeFile(path.join(outside, ".gitignore"), "top-only.ts\n")
		await fs.promises.writeFile(path.join(nested, ".gitignore"), "nested-only.ts\n")
		await writeInclude(outside)
		const [root] = await readRooInclude(workspace)
		expect(isIncludedRootGitEligible(path.join(nested, "top-only.ts"), root, defaults)).toBe(false)
		expect(isIncludedRootGitEligible(path.join(nested, "nested-only.ts"), root, defaults)).toBe(true)
		expect(isIncludedRootGitEligible(path.join(outside, "workspace-only.ts"), root, defaults)).toBe(true)
	})

	it.each(["missing", "unreadable"])("treats a %s top-level Git file as no rules without warning", async (state) => {
		await writeInclude(outside)
		if (state === "unreadable") denyRead(path.join(outside, ".gitignore"))
		const [root] = await readRooInclude(workspace)
		expect(isIncludedRootGitEligible(path.join(outside, "file.ts"), root, defaults)).toBe(true)
		expect(isIncludedRootGitEligible(`${path.join(outside, "folder")}/`, root, defaults)).toBe(true)
		expect(appendLine).not.toHaveBeenCalled()
	})

	it.each([false, true])("handles matcher failures with respectGitignore=%s", (respectGitignore) => {
		const root = context.includedRoots[0]
		const matcher = vi.spyOn(root.gitignore, "ignores").mockImplementation(() => {
			throw new Error("invalid match")
		})
		expect(isIncludedRootGitEligible(path.join(outside, "file.ts"), root, { ...defaults, respectGitignore })).toBe(
			!respectGitignore,
		)
		expect(matcher).toHaveBeenCalledTimes(respectGitignore ? 1 : 0)
	})
})

describe("context and path identity", () => {
	it("builds one context with workspace access rules and included roots", async () => {
		await fs.promises.writeFile(path.join(workspace, ".rooignore"), "blocked/\n")
		await writeInclude(outside)
		const result = await createDiscoveryContext(workspace)
		expect(result.workspaceRoot).toBe(workspace)
		expect(result.options).toEqual(defaults)
		expect(result.includedRoots.map(({ root }) => root)).toEqual([outside])
		expect(isDiscoveryPathAllowed(path.join(outside, "blocked", "file.ts"), result)).toBe(false)
		expect(isDiscoveryPathAllowed(path.join(workspace, ".rooignore"), result)).toBe(false)
	})

	it("uses supplied rules and options without reading workspace access rules or configuration", async () => {
		denyRead(path.join(workspace, ".rooignore"))
		const configuration = vi.mocked(vscode.workspace.getConfiguration)
		configuration.mockClear()
		const options = { respectGitignore: false, followSymlinks: true }
		const result = await createDiscoveryContext(workspace, options, "blocked.ts")
		expect(result.options).toBe(options)
		expect(isDiscoveryPathAllowed(path.join(workspace, "blocked.ts"), result)).toBe(false)
		expect(configuration).not.toHaveBeenCalled()
	})

	it("allows absent Roo rules but propagates unreadable access rules", async () => {
		expect((await createDiscoveryContext(workspace)).rooIgnore.ignores("visible.ts")).toBe(false)
		denyRead(path.join(workspace, ".rooignore"))
		await expect(createDiscoveryContext(workspace)).rejects.toThrow("permission")
	})

	it("distinguishes workspace children from sibling prefix collisions and parent paths", () => {
		expect(isUnderRoot(workspace, workspace)).toBe(true)
		expect(isUnderRoot(path.join(workspace, "child", "file.ts"), workspace)).toBe(true)
		expect(isUnderRoot(`${workspace}-sibling`, workspace)).toBe(false)
		expect(isUnderRoot(fixture, workspace)).toBe(false)
	})

	it("selects workspace or included-root relative paths without changing unowned paths", () => {
		const root: IncludedRoot = context.includedRoots[0]
		expect(getIncludedRoot(path.join(outside, "file.ts"), context)).toBe(root)
		expect(getIncludedRoot(`${outside}-sibling`, context)).toBeUndefined()
		expect(discoveryRelativePath(path.join(workspace, "nested", "file.ts"), context)).toBe(
			path.join("nested", "file.ts"),
		)
		expect(discoveryRelativePath(path.join(outside, "file.ts"), context)).toBe("file.ts")
		expect(discoveryRelativePath(fixture, context)).toBe(fixture)
	})

	it("gives normalized workspace-relative keys and normalized absolute outside keys", () => {
		expect(toIndexPath(path.join(workspace, "nested", "..", "file.ts"), workspace)).toBe("file.ts")
		expect(toIndexPath(workspace, workspace)).toBe(".")
		expect(toIndexPath(path.join(outside, "nested", "..", "file.ts"), workspace)).toBe(
			path.join(outside, "file.ts"),
		)
		expect(toIndexPath(path.join(`${workspace}-sibling`, "file.ts"), workspace)).toBe(
			path.join(`${workspace}-sibling`, "file.ts"),
		)
	})
})

describe("include parser scaling", () => {
	it("scales linearly across a 1x/2x/4x/8x comment-and-duplicate ladder", async () => {
		const root = await directory(workspace, "included")
		const readFile = fs.promises.readFile.bind(fs.promises)
		let content = ""
		vi.spyOn(fs.promises, "readFile").mockImplementation((...arguments_) => {
			if (String(arguments_[0]) === path.join(workspace, ".rooInclude")) return Promise.resolve(content)
			return readFile(...arguments_)
		})
		const unit = " # comment with whitespace\n\n included \n./included/../included\n"
		const timings: number[] = []
		for (const multiplier of [1, 2, 4, 8]) {
			content = unit.repeat(2_000 * multiplier)
			expect((await readRooInclude(workspace)).map(({ root: included }) => included)).toEqual([root])
			const samples: number[] = []
			for (let sample = 0; sample < 5; sample++) {
				const started = performance.now()
				for (let iteration = 0; iteration < 3; iteration++) await readRooInclude(workspace)
				samples.push((performance.now() - started) / 3)
			}
			timings.push(samples.sort((left, right) => left - right)[2])
		}
		console.info("include parser ladder (ms):", timings.map((duration) => duration.toFixed(3)).join(", "))
		expect(timings[2] / timings[0]).toBeLessThan(10)
		expect(timings[3] / timings[0]).toBeLessThan(20)
	})
})
