import * as childProcess from "child_process"
import { EventEmitter } from "events"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { PassThrough } from "stream"
import { performance } from "perf_hooks"
import * as discovery from "../../glob/discovery-options"
import { regexSearchFiles } from "../index"
import type { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"

const settings = vi.hoisted(() => ({ respectGitignore: true, followSymlinks: false }))
vi.mock("vscode", () => ({
	env: { appRoot: "vscode" },
	workspace: {
		getConfiguration: () => ({ get: (name: string) => settings[name.split(".").pop() as keyof typeof settings] }),
	},
}))
vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>()
	return { ...actual, realpathSync: vi.fn(actual.realpathSync) }
})
vi.mock("../../../utils/fs", () => ({ fileExistsAtPath: () => Promise.resolve(true) }))
vi.mock("child_process", () => ({ spawn: vi.fn() }))

function events(file: string, text = "needle", lineNumbers = [1]): string {
	return (
		[
			{ type: "begin", data: { path: { text: file } } },
			...lineNumbers.map((lineNumber) => ({
				type: "match",
				data: { line_number: lineNumber, lines: { text: `${text}\n` }, absolute_offset: 0 },
			})),
			{ type: "end", data: {} },
		]
			.map((event) => JSON.stringify(event))
			.join("\n") + "\n"
	)
}

describe("search discovery", () => {
	let fixture: string
	let workspace: string
	let included: string
	let outputs: string[]

	beforeEach(async () => {
		vi.restoreAllMocks()
		settings.respectGitignore = true
		settings.followSymlinks = false
		fixture = await fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-search-unit-"))
		workspace = path.join(fixture, "workspace")
		included = path.join(fixture, ".config", ".roo")
		await fs.promises.mkdir(workspace, { recursive: true })
		await fs.promises.mkdir(included, { recursive: true })
		outputs = []
		vi.mocked(childProcess.spawn).mockReset()
		vi.mocked(childProcess.spawn).mockImplementation(() => {
			const process = Object.assign(new EventEmitter(), {
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				kill: vi.fn(),
			})
			const output = outputs.shift() ?? ""
			setImmediate(() => {
				process.stdout.end(output)
				process.emit("close", 0)
			})
			return process as unknown as childProcess.ChildProcess
		})
	})

	afterEach(async () => {
		await fs.promises.rm(fixture, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	async function include() {
		await fs.promises.writeFile(path.join(workspace, ".rooInclude"), included)
	}

	it("preserves exact default absolute invocation and result formatting", async () => {
		outputs.push(events(path.join(workspace, "visible.ts")))
		const result = await regexSearchFiles(workspace, workspace, "needle")
		expect(childProcess.spawn).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
			"--json",
			"-e",
			"needle",
			"--context",
			"1",
			"--no-messages",
			workspace,
		])
		expect(result).toBe("Found 1 result.\n\n# visible.ts\n  1 | needle\n----")
	})

	it("preserves legacy parsing for contiguous matches, separated groups, context and multiple files", async () => {
		const first = path.join(workspace, "first.ts")
		const second = path.join(workspace, "second.ts")
		const context =
			JSON.stringify({
				type: "context",
				data: { line_number: 4, lines: { text: "context\n" } },
			}) + "\n"
		const firstEvents = events(first, "needle", [1, 2, 5])
		const endIndex = firstEvents.lastIndexOf('{"type":"end"')
		outputs.push(
			"invalid json\n" + firstEvents.slice(0, endIndex) + context + firstEvents.slice(endIndex) + events(second),
		)
		expect(await regexSearchFiles(workspace, workspace, "needle")).toBe(
			"Found 3 results.\n\n# first.ts\n  1 | needle\n  2 | needle\n----\n" +
				"  5 | needle\n  4 | context\n----\n\n# second.ts\n  1 | needle\n----",
		)
	})

	it("kills a hung ripgrep after 10 seconds and returns the partial matches already read", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		try {
			const kill = vi.fn()
			vi.mocked(childProcess.spawn).mockImplementation(() => {
				const process = Object.assign(new EventEmitter(), {
					stdout: new PassThrough(),
					stderr: new PassThrough(),
					kill,
				})
				kill.mockImplementation(() => {
					process.stdout.end()
					setImmediate(() => process.emit("close", null))
				})
				process.stdout.write(events(path.join(workspace, "partial.ts")))
				return process as unknown as childProcess.ChildProcess
			})
			const pending = regexSearchFiles(workspace, workspace, "needle")
			while (!vi.mocked(childProcess.spawn).mock.calls.length) {
				await new Promise((resolve) => setImmediate(resolve))
			}
			await vi.advanceTimersByTimeAsync(9_999)
			expect(kill).not.toHaveBeenCalled()
			await vi.advanceTimersByTimeAsync(1)
			expect(kill).toHaveBeenCalledOnce()
			expect(await pending).toBe("Found 1 result.\n\n# partial.ts\n  1 | needle\n----")
		} finally {
			vi.useRealTimers()
		}
	})

	it.each([false, true])("adds only selected legacy flags, follow=%s", async (followSymlinks) => {
		settings.followSymlinks = followSymlinks
		settings.respectGitignore = false
		await regexSearchFiles(workspace, workspace, "needle.*", "*.ts")
		const args = vi.mocked(childProcess.spawn).mock.calls[0][1]!
		expect(args).toContain("--no-ignore-vcs")
		expect(args.includes("--follow")).toBe(followSymlinks)
		expect(args).not.toContain("--no-ignore")
		expect(args.slice(0, 5)).toEqual(["--json", "-e", "needle.*", "--glob", "*.ts"])
	})

	it("adds included roots with cwd, relative target, shared exclusions and absolute result mapping", async () => {
		await include()
		outputs.push(events(path.join(workspace, "main.ts")), events("./visible.ts"))
		const result = await regexSearchFiles(workspace, workspace, "needle", "*.ts")
		const calls = vi.mocked(childProcess.spawn).mock.calls
		expect(calls).toHaveLength(2)
		expect(calls[1][2]).toEqual({ cwd: included })
		const args = calls[1][1]!
		expect(args.at(-1)).toBe(".")
		expect(args).toEqual(
			expect.arrayContaining([
				"--json",
				"needle",
				"*.ts",
				"--hidden",
				"!**/.*/**",
				"!**/node_modules/**",
				"--no-ignore-vcs",
			]),
		)
		expect(args).not.toContain("--files")
		expect(args).not.toContain("--no-ignore")
		expect(args).not.toContain("--follow")
		expect(result).toContain(`# ${path.relative(workspace, path.join(included, "visible.ts")).toPosix()}`)
	})

	it("searches only the requested included subtree, and does not expand arbitrary workspace subfolders", async () => {
		await include()
		settings.followSymlinks = true
		await regexSearchFiles(workspace, path.join(included, "child"), "needle")
		expect(childProcess.spawn).toHaveBeenCalledExactlyOnceWith(
			expect.any(String),
			expect.arrayContaining(["child", "--follow"]),
			{ cwd: included },
		)
		vi.mocked(childProcess.spawn).mockClear()
		const subfolder = path.join(workspace, "src")
		await regexSearchFiles(workspace, subfolder, "needle")
		expect(childProcess.spawn).toHaveBeenCalledExactlyOnceWith(
			expect.any(String),
			expect.arrayContaining([subfolder]),
		)
	})

	it.each([false, true])(
		"enforces Roo rules and included top-level Git rules before output bounds, Git=%s",
		async (respectGitignore) => {
			await include()
			settings.respectGitignore = respectGitignore
			await fs.promises.writeFile(path.join(workspace, ".rooignore"), "secret/\n*.pem\n")
			await fs.promises.writeFile(path.join(included, ".gitignore"), "generated/\n")
			outputs.push(
				events(path.join(workspace, "secret", "blocked.ts")),
				events(
					"secret/blocked.ts",
					"blocked",
					Array.from({ length: 1700 }, (_, index) => index + 1),
				) +
					events("key.pem") +
					events("generated/git.ts") +
					events("visible.ts"),
			)
			const result = await regexSearchFiles(workspace, workspace, "needle")
			expect(result).not.toContain("blocked")
			expect(result).not.toContain("key.pem")
			expect(result.includes("generated/git.ts")).toBe(!respectGitignore)
			expect(result).toContain("visible.ts")
		},
	)

	it("uses controller content rather than legacy validateAccess and blocks matcher errors", async () => {
		const controller = { rooIgnoreContent: "secret/", validateAccess: vi.fn(() => true) }
		outputs.push(events(path.join(workspace, "secret", "blocked.ts")))
		expect(
			await regexSearchFiles(
				workspace,
				workspace,
				"needle",
				undefined,
				controller as unknown as RooIgnoreController,
			),
		).toBe("Found 0 results.")
		expect(controller.validateAccess).not.toHaveBeenCalled()
		const context = await discovery.createDiscoveryContext(workspace)
		vi.spyOn(context.rooIgnore, "ignores").mockImplementation(() => {
			throw new Error("matcher failure")
		})
		vi.spyOn(discovery, "createDiscoveryContext").mockResolvedValue(context)
		outputs.push(events(path.join(workspace, "visible.ts")))
		expect(await regexSearchFiles(workspace, workspace, "needle")).toBe("Found 0 results.")
	})

	it("preserves explicit outside scope without applying workspace Roo rules", async () => {
		await fs.promises.writeFile(path.join(workspace, ".rooignore"), "secret/\n")
		outputs.push(events(path.join(included, "visible.ts")) + events(path.join(included, "secret", "blocked.ts")))
		const result = await regexSearchFiles(workspace, included, "needle")
		expect(result).toContain("visible.ts")
		expect(result).toContain("blocked.ts")
		expect(childProcess.spawn).toHaveBeenCalledExactlyOnceWith(
			expect.any(String),
			expect.arrayContaining([included]),
		)
	})

	it("preserves legacy controller checks for unlisted outside requests", async () => {
		const controller = { rooIgnoreContent: "src/", validateAccess: vi.fn(() => true) }
		const source = path.join(included, "src", "file.ts")
		outputs.push(events(source))
		expect(
			await regexSearchFiles(
				workspace,
				included,
				"needle",
				undefined,
				controller as unknown as RooIgnoreController,
			),
		).toContain("src/file.ts")
		expect(controller.validateAccess).toHaveBeenCalledWith(source)
	})

	it("does not resolve real paths with defaults and no inclusions", async () => {
		const realpath = vi.mocked(fs.realpathSync).mockClear()
		const asyncRealpath = vi.spyOn(fs.promises, "realpath")
		outputs.push(events(path.join(workspace, "visible.ts")))
		expect(await regexSearchFiles(workspace, workspace, "needle")).toContain("visible.ts")
		expect(realpath).not.toHaveBeenCalled()
		expect(asyncRealpath).not.toHaveBeenCalled()
	})

	it("deduplicates overlapping absolute paths and caps merged result groups at 300", async () => {
		const overlapping = path.join(workspace, "included")
		await fs.promises.mkdir(overlapping)
		await fs.promises.writeFile(path.join(workspace, ".rooInclude"), overlapping)
		const lineNumbers = Array.from({ length: 200 }, (_, index) => index * 3 + 1)
		outputs.push(
			events(path.join(overlapping, "same.ts"), "needle", lineNumbers),
			events("same.ts", "needle", lineNumbers) + events("other.ts", "needle", lineNumbers),
		)
		const result = await regexSearchFiles(workspace, workspace, "needle")
		expect(result.match(/# included\/same.ts/g)).toHaveLength(1)
		expect(result.match(/\| needle/g)).toHaveLength(300)
		expect(result).toContain("Showing first 300")
	})

	it("keeps incremental parsing linear over a 1x/2x/4x/8x blocked-output ladder", async () => {
		await fs.promises.writeFile(path.join(workspace, ".rooignore"), "blocked/\n")
		const base = events(path.join(workspace, "blocked", "file.ts"))
		const samples: number[] = []
		for (const multiplier of [1, 2, 4, 8]) {
			const timings: number[] = []
			for (let repetition = 0; repetition < 5; repetition++) {
				outputs.push(base.repeat(1000 * multiplier) + events(path.join(workspace, "visible.ts")))
				const start = performance.now()
				expect(await regexSearchFiles(workspace, workspace, "needle")).toContain("# visible.ts")
				timings.push(performance.now() - start)
			}
			samples.push(timings.sort((left, right) => left - right)[2])
		}
		console.log("Search parsing ladder milliseconds (1x/2x/4x/8x):", samples)
		expect(samples[2] / samples[0]).toBeLessThan(10)
		expect(samples[3] / samples[0]).toBeLessThan(20)
	})
})
