import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { listFiles } from "../list-files"
import { createDiscoveryContext } from "../discovery-options"

vi.mock("vscode", () => ({ env: { appRoot: "" } }))
vi.mock("../../ripgrep", () => ({ getBinPath: () => Promise.resolve(process.env.ROO_TEST_RG) }))

const realRipgrep = process.env.ROO_TEST_RG ? describe : describe.skip

realRipgrep("listing with real ripgrep", () => {
	let fixture: string
	let workspace: string
	let included: string

	beforeEach(async () => {
		fixture = await fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-real-list-"))
		workspace = path.join(fixture, "workspace")
		included = path.join(fixture, ".config", ".roo")
		await fs.promises.mkdir(workspace, { recursive: true })
		await fs.promises.mkdir(included, { recursive: true })
		await fs.promises.writeFile(path.join(workspace, ".rooInclude"), included)
		await fs.promises.writeFile(path.join(workspace, ".rooignore"), "secret/\n*.pem\n")
	})

	afterEach(async () => {
		await fs.promises.rm(fixture, { recursive: true, force: true })
	})

	async function file(root: string, relativePath: string) {
		const absolutePath = path.join(root, relativePath)
		await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true })
		await fs.promises.writeFile(absolutePath, "test")
		return absolutePath
	}

	it.each([false, true])(
		"blocks real link targets with defaults and no inclusions, showIgnored=%s",
		async (showIgnored) => {
			await fs.promises.unlink(path.join(workspace, ".rooInclude"))
			await file(workspace, "secret/file.ts")
			const visible = await file(workspace, "visible.ts")
			const alias = path.join(workspace, "alias")
			await fs.promises.symlink(path.join(workspace, "secret"), alias, "dir")
			expect((await fs.promises.lstat(alias)).isSymbolicLink()).toBe(true)
			const context = await createDiscoveryContext(workspace, { respectGitignore: true, followSymlinks: false })
			expect(context.includedRoots).toEqual([])
			const linkedFile = path.join(alias, "file.ts")
			const [entries, , blockedPaths] = await listFiles(workspace, true, 100, context, showIgnored)
			expect(entries).toContain(visible)
			expect(entries.includes(linkedFile)).toBe(showIgnored)
			expect(blockedPaths?.includes(linkedFile)).toBe(showIgnored)
		},
	)

	it.each([false, true])("preserves unlisted outside results, recursive=%s", async (recursive) => {
		const outside = path.join(fixture, "outside")
		const source = await file(outside, "src/file.ts")
		const visible = await file(outside, "visible.ts")
		await fs.promises.writeFile(path.join(workspace, ".rooignore"), "src/\n*.ts\n")
		const context = await createDiscoveryContext(workspace, { respectGitignore: true, followSymlinks: false })
		const [entries] = await listFiles(outside, recursive, 100, context)
		expect(entries).toEqual([`${path.join(outside, "src")}/`, ...(recursive ? [source] : []), visible])
	})

	it.each([false, true])(
		"enters hidden roots without entering hidden descendants, Git=%s",
		async (respectGitignore) => {
			const visible = await file(included, "visible.ts")
			const gitOnly = await file(included, "git-only/child.ts")
			const nestedGit = await file(included, "child/nested.ts")
			await file(included, ".nested/hidden.ts")
			await file(included, "node_modules/package.ts")
			await file(included, "secret/blocked.ts")
			await file(included, "key.pem")
			await file(included, "rg-ignored/file.ts")
			await fs.promises.writeFile(path.join(included, ".gitignore"), "git-only/\n")
			await fs.promises.writeFile(path.join(included, "child", ".gitignore"), "nested.ts\n")
			await fs.promises.writeFile(path.join(included, ".rgignore"), "rg-ignored/\n")
			const context = await createDiscoveryContext(workspace, { respectGitignore, followSymlinks: false })
			const [entries] = await listFiles(workspace, true, 100, context)
			expect(entries).toContain(visible)
			expect(entries).toContain(nestedGit)
			expect(entries.includes(gitOnly)).toBe(!respectGitignore)
			expect(entries.includes(`${path.dirname(gitOnly)}/`)).toBe(!respectGitignore)
			expect(entries.some((entry) => entry.includes("secret") || entry.endsWith(".pem"))).toBe(false)
			expect(entries.some((entry) => entry.includes(".nested") || entry.includes("node_modules"))).toBe(false)
			expect(entries).not.toContain(path.join(included, "rg-ignored", "file.ts"))
		},
	)

	it.each([false, true])("follows links inside a named link root only with the flag: %s", async (followSymlinks) => {
		const target = path.join(fixture, "target")
		await file(target, "linked.ts")
		await file(included, "visible.ts")
		await fs.promises.symlink(
			target,
			path.join(included, "inner"),
			process.platform === "win32" ? "junction" : "dir",
		)
		const alias = path.join(fixture, "root-alias")
		await fs.promises.symlink(included, alias, process.platform === "win32" ? "junction" : "dir")
		await fs.promises.writeFile(path.join(workspace, ".rooInclude"), alias)
		const context = await createDiscoveryContext(workspace, { respectGitignore: true, followSymlinks })
		const [entries] = await listFiles(alias, true, 100, context)
		expect(entries).toContain(path.join(alias, "visible.ts"))
		expect(entries.includes(path.join(alias, "inner", "linked.ts"))).toBe(followSymlinks)
		expect(entries.includes(`${path.join(alias, "inner")}/`)).toBe(followSymlinks)
	})

	it.each([false, true])(
		"traverses a true symbolic-link root and follows inner directory and file links only with the flag: %s",
		async (followSymlinks) => {
			const target = path.join(fixture, "target")
			await file(target, "linked.ts")
			const fileTarget = await file(fixture, "loose.ts")
			await file(included, "visible.ts")
			await fs.promises.symlink(target, path.join(included, "inner"), "dir")
			await fs.promises.symlink(fileTarget, path.join(included, "file-link.ts"), "file")
			const alias = path.join(fixture, "root-alias")
			await fs.promises.symlink(included, alias, "dir")
			expect((await fs.promises.lstat(alias)).isSymbolicLink()).toBe(true)
			await fs.promises.writeFile(path.join(workspace, ".rooInclude"), alias)
			const context = await createDiscoveryContext(workspace, { respectGitignore: true, followSymlinks })
			const [entries] = await listFiles(workspace, true, 100, context)
			expect(entries).toContain(path.join(alias, "visible.ts"))
			expect(entries.includes(path.join(alias, "inner", "linked.ts"))).toBe(followSymlinks)
			expect(entries.includes(path.join(alias, "file-link.ts"))).toBe(followSymlinks)
		},
	)

	it.each([false, true])(
		"bypasses Git-ignored directory contents in legacy listing, recursive=%s",
		async (recursive) => {
			await fs.promises.mkdir(path.join(workspace, ".git"))
			await fs.promises.writeFile(path.join(workspace, ".gitignore"), "generated/\nignored.ts\n")
			const ignoredFile = await file(workspace, "ignored.ts")
			const descendant = await file(workspace, "generated/child.ts")
			const options = { respectGitignore: false, followSymlinks: false }
			const context = await createDiscoveryContext(workspace, options)
			const [entries] = await listFiles(workspace, recursive, 100, context)
			expect(entries).toContain(ignoredFile)
			expect(entries).toContain(`${path.join(workspace, "generated")}/`)
			expect(entries.includes(descendant)).toBe(recursive)
		},
	)
})
