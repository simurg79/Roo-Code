import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { regexSearchFiles } from "../index"

const settings = vi.hoisted(() => ({ respectGitignore: true, followSymlinks: false }))
vi.mock("vscode", () => ({
	env: {
		get appRoot() {
			return process.env.ROO_TEST_VSCODE_ROOT ?? ""
		},
	},
	workspace: {
		getConfiguration: () => ({ get: (name: string) => settings[name.split(".").pop() as keyof typeof settings] }),
	},
}))

const realRipgrep = process.env.ROO_TEST_VSCODE_ROOT ? describe : describe.skip

realRipgrep("search with real ripgrep", () => {
	let fixture: string
	let workspace: string
	let hidden: string
	let outside: string

	async function file(root: string, relativePath: string, content = "needle") {
		const absolutePath = path.join(root, relativePath)
		await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true })
		await fs.promises.writeFile(absolutePath, content)
		return absolutePath
	}

	beforeEach(async () => {
		settings.respectGitignore = true
		settings.followSymlinks = false
		fixture = await fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-real-search-"))
		workspace = path.join(fixture, "workspace")
		hidden = path.join(workspace, ".roo")
		outside = path.join(fixture, ".config", "outside")
		for (const root of [workspace, hidden, outside]) await fs.promises.mkdir(root, { recursive: true })
		await fs.promises.mkdir(path.join(workspace, ".git"))
		await fs.promises.writeFile(path.join(workspace, ".rooInclude"), `${hidden}\n${outside}\n`)
		await fs.promises.writeFile(path.join(workspace, ".rooignore"), "secret/\n*.pem\n")
	})

	afterEach(async () => {
		await fs.promises.rm(fixture, { recursive: true, force: true })
	})

	it("preserves unlisted outside results", async () => {
		const unlisted = path.join(fixture, "unlisted")
		await file(unlisted, "src/file.ts")
		await fs.promises.writeFile(path.join(workspace, ".rooignore"), "src/\n*.ts\n")
		expect(await regexSearchFiles(workspace, unlisted, "needle")).toBe(
			"Found 1 result.\n\n# ../unlisted/src/file.ts\n  1 | needle\n----",
		)
	})

	it.each([false, true])(
		"searches hidden and outside roots, respecting access/Git/filter boundaries, Git=%s",
		async (respectGitignore) => {
			settings.respectGitignore = respectGitignore
			for (const root of [workspace, hidden, outside]) {
				await file(root, "visible.ts")
				await file(root, "secret/blocked.ts")
				await file(root, "key.pem")
				await file(root, "generated/git.ts")
				await fs.promises.writeFile(path.join(root, ".gitignore"), "generated/\n")
			}
			for (const root of [hidden, outside]) {
				await file(root, "child/nested.ts")
				await file(root, "child/.gitignore", "nested.ts\n")
				await file(root, ".nested/hidden.ts")
				await file(root, "node_modules/package.ts")
				await file(root, "rg-ignored/file.ts")
				await file(root, ".rgignore", "rg-ignored/\n")
				await file(root, "other.txt")
				await file(root, "no-query.ts", "different content")
			}
			const result = await regexSearchFiles(workspace, workspace, "needle")
			expect(result).toContain("# visible.ts")
			expect(result).toContain("# .roo/visible.ts")
			expect(result).toContain("# ../.config/outside/visible.ts")
			expect(result).toContain("# .roo/child/nested.ts")
			expect(result.includes("generated/git.ts")).toBe(!respectGitignore)
			for (const excluded of ["blocked.ts", "key.pem", "hidden.ts", "package.ts", "rg-ignored", "no-query.ts"]) {
				expect(result).not.toContain(excluded)
			}
			const filtered = await regexSearchFiles(workspace, workspace, "needle", "*.ts")
			expect(filtered).not.toContain("other.txt")
			expect(filtered).not.toContain("blocked.ts")
			expect(filtered).not.toContain("key.pem")
			expect(filtered.includes(".roo/generated/git.ts")).toBe(!respectGitignore)
			const subtree = await regexSearchFiles(workspace, path.join(outside, "child"), "needle", "*.ts")
			expect(subtree).toContain("outside/child/nested.ts")
			expect(subtree).not.toContain("visible.ts")
			await file(workspace, "src/local.ts")
			const narrow = await regexSearchFiles(workspace, path.join(workspace, "src"), "needle")
			expect(narrow).toContain("src/local.ts")
			expect(narrow).not.toContain("outside")
			expect(narrow).not.toContain(".roo/")
		},
	)

	it.each([false, true])(
		"enters a named junction root and follows inner links only when enabled: %s",
		async (followSymlinks) => {
			settings.followSymlinks = followSymlinks
			await file(outside, "visible.ts")
			const target = path.join(fixture, "target")
			await file(target, "linked.ts")
			await fs.promises.symlink(
				target,
				path.join(outside, "inner"),
				process.platform === "win32" ? "junction" : "dir",
			)
			const alias = path.join(fixture, "root-alias")
			await fs.promises.symlink(outside, alias, process.platform === "win32" ? "junction" : "dir")
			await fs.promises.writeFile(path.join(workspace, ".rooInclude"), alias)
			const result = await regexSearchFiles(workspace, alias, "needle")
			expect(result).toContain("root-alias/visible.ts")
			expect(result.includes("inner/linked.ts")).toBe(followSymlinks)
		},
	)

	it.each([false, true])(
		"blocks workspace aliases and in-workspace real targets in both Git states: %s",
		async (respectGitignore) => {
			settings.respectGitignore = respectGitignore
			settings.followSymlinks = true
			await file(workspace, "secret/real-blocked.ts")
			await file(outside, "visible.ts")
			const linkType = process.platform === "win32" ? "junction" : "dir"
			await fs.promises.symlink(path.join(workspace, "secret"), path.join(workspace, "alias"), linkType)
			await fs.promises.symlink(path.join(workspace, "secret"), path.join(outside, "alias"), linkType)
			await fs.promises.symlink(outside, path.join(workspace, "blocked-alias"), linkType)
			await fs.promises.writeFile(path.join(workspace, ".rooignore"), "secret/\nblocked-alias/\n*.pem\n")
			const result = await regexSearchFiles(workspace, workspace, "needle")
			expect(result).toContain("outside/visible.ts")
			expect(result).not.toContain("real-blocked.ts")
			expect(result).not.toContain("blocked-alias/")
		},
	)

	it("preserves no-inclusion defaults and toggles legacy Git-ignored descendants and link traversal", async () => {
		await fs.promises.unlink(path.join(workspace, ".rooInclude"))
		await file(workspace, "visible.ts")
		await file(workspace, "generated/child.ts")
		await file(workspace, ".hidden/hidden.ts")
		await file(outside, "linked.ts")
		await fs.promises.writeFile(path.join(workspace, ".gitignore"), "generated/\n")
		await fs.promises.symlink(
			outside,
			path.join(workspace, "link"),
			process.platform === "win32" ? "junction" : "dir",
		)
		const defaults = await regexSearchFiles(workspace, workspace, "needle")
		expect(defaults).toContain("# visible.ts")
		expect(defaults).not.toContain("child.ts")
		expect(defaults).not.toContain("hidden.ts")
		expect(defaults).not.toContain("linked.ts")
		settings.respectGitignore = false
		settings.followSymlinks = true
		const enabled = await regexSearchFiles(workspace, workspace, "needle")
		expect(enabled).toContain("generated/child.ts")
		expect(enabled).toContain("link/linked.ts")
		expect(enabled).not.toContain("hidden.ts")
	})
})
