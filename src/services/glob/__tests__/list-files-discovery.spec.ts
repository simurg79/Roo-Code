import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as childProcess from "child_process"
import { EventEmitter } from "events"
import ignore from "ignore"
import * as vscode from "vscode"
import { buildIncludedRootArgs, listFiles } from "../list-files"
import { type DiscoveryContext } from "../discovery-options"
import { DIRS_TO_IGNORE } from "../constants"

vi.mock("vscode", () => ({
	env: { appRoot: "/mock/app" },
	workspace: {
		getWorkspaceFolder: vi.fn(),
		workspaceFolders: [],
		getConfiguration: () => ({ get: (_key: string, fallback: boolean) => fallback }),
	},
	Uri: { file: (filePath: string) => ({ fsPath: filePath }) },
}))
vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>()
	return { ...actual, realpathSync: vi.fn(actual.realpathSync) }
})
vi.mock("../../ripgrep", () => ({ getBinPath: () => Promise.resolve("rg") }))
vi.mock("child_process", () => ({ spawn: vi.fn() }))

let fixture: string
let workspace: string
let outside: string
let context: DiscoveryContext
let outputs: string[]

beforeEach(async () => {
	vi.clearAllMocks()
	fixture = await fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-list-discovery-"))
	workspace = path.join(fixture, "workspace")
	outside = path.join(fixture, ".config", "outside")
	await fs.promises.mkdir(workspace, { recursive: true })
	await fs.promises.mkdir(outside, { recursive: true })
	context = {
		workspaceRoot: workspace,
		options: { respectGitignore: true, followSymlinks: false },
		rooIgnore: ignore().add("secret/\n*.pem"),
		includedRoots: [{ root: outside, ignoreBase: outside, gitignore: ignore().add("git-only/") }],
	}
	outputs = []
	vi.mocked(childProcess.spawn).mockImplementation(() => {
		const process = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			kill: vi.fn(),
		})
		const output = outputs.shift() ?? ""
		queueMicrotask(() => {
			process.stdout.emit("data", Buffer.from(output))
			process.emit("close", 0)
		})
		return process as unknown as childProcess.ChildProcess
	})
})

afterEach(async () => {
	await fs.promises.rm(fixture, { recursive: true, force: true })
})

async function directory(root: string, name: string) {
	await fs.promises.mkdir(path.join(root, name), { recursive: true })
	return `${path.join(root, name)}/`
}

describe("included traversal arguments", () => {
	it.each([false, true])("returns only traversal arguments with follow=%s", (followSymlinks) => {
		const args = buildIncludedRootArgs("child", { respectGitignore: true, followSymlinks })
		expect(args.at(-1)).toBe("child")
		expect(args).toContain("--hidden")
		expect(args).toContain("!**/.*/**")
		expect(args).toContain("--no-ignore-vcs")
		for (const name of DIRS_TO_IGNORE.filter((name) => name !== ".*")) {
			expect(args).toContain(`!**/${name}/**`)
		}
		expect(args.includes("--follow")).toBe(followSymlinks)
		expect(args).not.toContain("--no-ignore")
		expect(args).not.toContain("--files")
		expect(args).not.toContain("--json")
	})
})

describe("listing discovery", () => {
	it("merges workspace and included roots using relative targets and root cwd", async () => {
		outputs = [`${path.join(workspace, "local.ts")}\n`, "./visible.ts\r\n"]
		const child = await directory(outside, "child")
		await directory(outside, ".nested")
		await directory(outside, "node_modules")
		const [entries] = await listFiles(workspace, true, 100, context)
		expect(entries).toEqual(
			expect.arrayContaining([
				path.join(workspace, "local.ts"),
				`${outside}/`,
				child,
				path.join(outside, "visible.ts"),
			]),
		)
		expect(entries.some((entry) => entry.includes(".nested") || entry.includes("node_modules"))).toBe(false)
		const calls = vi.mocked(childProcess.spawn).mock.calls
		expect(calls[0]).toHaveLength(2)
		expect(calls[0][1]?.at(-1)).toBe(workspace)
		expect(calls[0][1]).toContain("--follow")
		expect(calls[1][1]?.at(-1)).toBe(".")
		expect(calls[1][1]).not.toContain("--follow")
		expect(calls[1][1]).not.toContain("--no-ignore")
		expect(calls[1][2]).toEqual({ cwd: outside })
	})

	it("kills a hung ripgrep after 10 seconds and returns the partial entries already read", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const kill = vi.fn()
			vi.mocked(childProcess.spawn).mockImplementation(() => {
				const process = Object.assign(new EventEmitter(), {
					stdout: new EventEmitter(),
					stderr: new EventEmitter(),
					kill,
				})
				kill.mockImplementation(() => queueMicrotask(() => process.emit("close", null)))
				queueMicrotask(() => process.stdout.emit("data", Buffer.from("./visible.ts\n")))
				return process as unknown as childProcess.ChildProcess
			})
			const pending = listFiles(outside, true, 100, context)
			while (!vi.mocked(childProcess.spawn).mock.calls.length) {
				await new Promise((resolve) => setImmediate(resolve))
			}
			await vi.advanceTimersByTimeAsync(9_999)
			expect(kill).not.toHaveBeenCalled()
			await vi.advanceTimersByTimeAsync(1)
			expect(kill).toHaveBeenCalledOnce()
			const [entries] = await pending
			expect(entries).toContain(path.join(outside, "visible.ts"))
			expect(warn).toHaveBeenCalledWith("ripgrep timed out, returning partial results")
		} finally {
			warn.mockRestore()
			vi.useRealTimers()
		}
	})

	it.each([false, true])(
		"filters files and directories before the limit, respectGitignore=%s",
		async (respectGitignore) => {
			context.options.respectGitignore = respectGitignore
			await directory(outside, "secret/nested")
			const gitOnly = await directory(outside, "git-only")
			const allowed = await directory(outside, "allowed")
			outputs = ["secret/blocked.ts\nkey.pem\ngit-only/file.ts\nvisible.ts\n"]
			const [entries] = await listFiles(outside, true, 3, context)
			expect(entries).toContain(allowed)
			expect(entries.some((entry) => entry.includes("secret") || entry.endsWith(".pem"))).toBe(false)
			expect(entries.includes(gitOnly)).toBe(!respectGitignore)
			if (respectGitignore) expect(entries).toContain(path.join(outside, "visible.ts"))
		},
	)

	it("adds only included root entries for nonrecursive workspace requests", async () => {
		await directory(outside, "child")
		outputs = ["local.ts\n"]
		const [entries] = await listFiles(workspace, false, 100, context)
		expect(entries).toEqual([`${outside}/`, path.join(workspace, "local.ts")])
		expect(childProcess.spawn).toHaveBeenCalledOnce()
	})

	it.each([false, true])("keeps included subfolder requests scoped, recursive=%s", async (recursive) => {
		const child = path.join(outside, "child")
		await directory(outside, "child/nested")
		outputs = ["child/file.ts\n"]
		const [entries] = await listFiles(child, recursive, 100, context)
		expect(entries).toContain(path.join(child, "file.ts"))
		expect(entries.every((entry) => entry.startsWith(child))).toBe(true)
		expect(childProcess.spawn).toHaveBeenCalledOnce()
		expect(vi.mocked(childProcess.spawn).mock.calls[0][1]?.at(-1)).toBe("child")
		expect(vi.mocked(childProcess.spawn).mock.calls[0][2]).toEqual({ cwd: outside })
	})

	it("does not add included roots to an ordinary workspace subfolder", async () => {
		const child = path.join(workspace, "child")
		await directory(workspace, "child")
		outputs = ["file.ts\n"]
		const [entries] = await listFiles(child, true, 100, context)
		expect(entries).toEqual([path.join(child, "file.ts")])
		expect(childProcess.spawn).toHaveBeenCalledOnce()
	})

	it.each([false, true])("bypasses filesystem Git filtering in both recursion modes: %s", async (recursive) => {
		context.options.respectGitignore = false
		context.includedRoots = []
		await fs.promises.writeFile(path.join(workspace, ".gitignore"), "git-only/\n")
		const gitOnly = await directory(workspace, "git-only/nested")
		outputs = ["visible.ts\n"]
		const [entries] = await listFiles(workspace, recursive, 100, context)
		expect(entries).toContain(`${path.join(workspace, "git-only")}/`)
		expect(entries.includes(gitOnly)).toBe(recursive)
		expect(vi.mocked(childProcess.spawn).mock.calls[0][1]).toContain("--no-ignore-vcs")
	})

	it("uses the actual workspace for a subfolder's default context", async () => {
		const child = path.join(workspace, "child")
		await directory(workspace, "child")
		await fs.promises.writeFile(path.join(workspace, ".rooignore"), "child/blocked.ts\n")
		vi.mocked(vscode.workspace.getWorkspaceFolder).mockReturnValue({
			uri: { fsPath: workspace },
		} as vscode.WorkspaceFolder)
		outputs = ["blocked.ts\nvisible.ts\n"]
		const [entries] = await listFiles(child, false, 1)
		expect(entries).toEqual([path.join(child, "visible.ts")])
	})

	it.each([false, true])(
		"preserves unlisted outside requests without workspace Roo filtering, recursive=%s",
		async (recursive) => {
			context.includedRoots = []
			context.rooIgnore.add("src/")
			const source = await directory(outside, "src")
			outputs = ["src/file.ts\nkey.pem\nvisible.ts\n"]
			const [entries, , blockedPaths] = await listFiles(outside, recursive, 100, context)
			expect(entries).toEqual([
				source,
				path.join(outside, "key.pem"),
				path.join(outside, "src", "file.ts"),
				path.join(outside, "visible.ts"),
			])
			expect(blockedPaths).toBeUndefined()
			expect(vi.mocked(childProcess.spawn).mock.calls[0]).toHaveLength(2)
			expect(vi.mocked(childProcess.spawn).mock.calls[0][1]?.at(-1)).toBe(outside)
		},
	)

	it.each([false, true])("retains blocked names only for locked display, showIgnored=%s", async (showIgnored) => {
		outputs = ["secret/file.ts\nvisible.ts\n"]
		const [entries, , blockedPaths] = await listFiles(outside, true, 100, context, showIgnored)
		expect(entries.includes(path.join(outside, "secret", "file.ts"))).toBe(showIgnored)
		expect(blockedPaths).toEqual(showIgnored ? [path.join(outside, "secret", "file.ts")] : [])
	})

	it("does not resolve real paths with defaults, no inclusions and no Roo rules", async () => {
		context.includedRoots = []
		context.rooIgnore = ignore()
		context.hasRooIgnoreRules = false
		outputs = ["visible.ts\n"]
		const realpath = vi.mocked(fs.realpathSync)
		realpath.mockClear()
		const asyncRealpath = vi.spyOn(fs.promises, "realpath")
		try {
			expect((await listFiles(workspace, true, 100, context))[0]).toEqual([path.join(workspace, "visible.ts")])
			expect(realpath).not.toHaveBeenCalled()
			expect(asyncRealpath).not.toHaveBeenCalled()
		} finally {
			asyncRealpath.mockRestore()
		}
	})

	// An empty blocked list tells the scanner access was checked; unchecked exits must omit it.
	it("omits the blocked-path list on every unchecked early return", async () => {
		const zeroLimit = await listFiles(workspace, true, 0, context)
		const blockedRequest = await listFiles(path.join(workspace, "secret"), true, 100, context)
		const filesystemRoot = await listFiles(path.parse(workspace).root, false, 100, context)
		const homeDirectory = await listFiles(os.homedir(), false, 100, context)
		for (const result of [zeroLimit, blockedRequest, filesystemRoot, homeDirectory]) {
			expect(result[2]).toBeUndefined()
		}
		expect(childProcess.spawn).not.toHaveBeenCalled()
	})

	it("deduplicates overlapping roots", async () => {
		const child = path.join(workspace, "child")
		await directory(workspace, "child")
		context.includedRoots = [{ root: child, ignoreBase: child, gitignore: ignore() }]
		outputs = ["child/file.ts\n", "./file.ts\n"]
		const [entries] = await listFiles(workspace, true, 100, context)
		expect(entries.filter((entry) => entry === path.join(child, "file.ts"))).toHaveLength(1)
	})

	it("reads inclusion and access changes on subsequent calls", async () => {
		vi.mocked(vscode.workspace.getWorkspaceFolder).mockReturnValue({
			uri: { fsPath: workspace },
		} as vscode.WorkspaceFolder)
		await fs.promises.writeFile(path.join(workspace, ".rooInclude"), outside)
		outputs = ["", "visible.ts\n"]
		expect((await listFiles(workspace, true, 100))[0]).toContain(path.join(outside, "visible.ts"))
		await fs.promises.writeFile(path.join(workspace, ".rooignore"), "visible.ts\n")
		outputs = ["", "visible.ts\n"]
		expect((await listFiles(workspace, true, 100))[0]).not.toContain(path.join(outside, "visible.ts"))
	})

	it.each([false, true])("keeps workspace access exclusions authoritative, Git=%s", async (respectGitignore) => {
		context.options = { respectGitignore, followSymlinks: true }
		await directory(workspace, "secret/nested")
		outputs = ["secret/blocked.ts\nkey.pem\nvisible.ts\n", ""]
		const [entries] = await listFiles(workspace, true, 100, context)
		expect(entries).toContain(path.join(workspace, "visible.ts"))
		expect(entries.some((entry) => entry.includes("secret") || entry.endsWith(".pem"))).toBe(false)
		expect(vi.mocked(childProcess.spawn).mock.calls[0][1]).toContain("--follow")
	})

	it("fails closed when the access matcher throws", async () => {
		context.rooIgnore.ignores = () => {
			throw new Error("matcher failure")
		}
		outputs = ["blocked.ts\n"]
		const [entries] = await listFiles(path.join(workspace, "child"), true, 100, context)
		expect(entries).toEqual([])
	})

	it("keeps streamed path filtering approximately linear across an input ladder", async () => {
		context.includedRoots = []
		const visible = path.join(workspace, "visible.ts")
		await fs.promises.writeFile(visible, "visible")
		// Isolate streamed filtering from repeated filesystem resolution.
		const realpath = vi.mocked(fs.realpathSync).mockImplementation((entry) => entry.toString())
		try {
			const measure = async (count: number) => {
				outputs = [`${visible}\r\n`.repeat(count)]
				const started = performance.now()
				const [entries] = await listFiles(workspace, false, count + 1, context)
				expect(entries).toEqual([visible])
				return performance.now() - started
			}
			await measure(256)
			const timings: number[] = []
			for (const multiplier of [1, 2, 4, 8]) {
				const samples: number[] = []
				for (let sample = 0; sample < 3; sample++) samples.push(await measure(256 * multiplier))
				timings.push(Math.min(...samples))
			}
			console.log("listing 1x/2x/4x/8x milliseconds:", timings)
			expect(timings[2] / timings[0]).toBeLessThan(12)
			expect(timings[3] / timings[0]).toBeLessThan(24)
		} finally {
			realpath.mockRestore()
		}
	})

	it("blocks an alias whose real path is excluded inside the workspace", async () => {
		const target = path.join(workspace, "secret")
		await directory(workspace, "secret")
		await fs.promises.writeFile(path.join(target, "file.ts"), "blocked")
		const alias = path.join(workspace, "alias")
		await fs.promises.symlink(target, alias, process.platform === "win32" ? "junction" : "dir")
		outputs = ["alias/file.ts\nvisible.ts\n"]
		const [entries] = await listFiles(workspace, true, 100, context)
		expect(entries.some((entry) => entry.includes("alias") || entry.includes("secret"))).toBe(false)
	})
})
