import "../../__tests__/mock-code-index-log"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"
import ignore from "ignore"
import { DirectoryScanner } from "../scanner"
import { FileWatcher } from "../file-watcher"
import { CacheManager } from "../../cache-manager"
import { FileFailureRegistry } from "../../file-failure-registry"
import { GenerationAllocator } from "../../generation-allocator"
import { IndexWriteGate } from "../../index-write-gate"
import { createDiscoveryContext, toIndexPath, type DiscoveryContext } from "../../../glob/discovery-options"
import { findStartupDirectoryLinks } from "../../discovery"
import { listFiles } from "../../../glob/list-files"
import { safeWriteJson } from "../../../../utils/safeWriteJson"

vi.mock("../../../../utils/path", () => ({ getWorkspacePathForContext: (directory: string) => directory }))
vi.mock("../../../glob/list-files", () => ({ listFiles: vi.fn() }))
vi.mock("../../../../utils/safeWriteJson", () => ({ safeWriteJson: vi.fn(async () => {}) }))
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: () => ({ get: (_name: string, fallback: unknown) => fallback }),
		createFileSystemWatcher: vi.fn(),
		fs: {
			readFile: (uri: { fsPath: string }) => fs.promises.readFile(uri.fsPath),
			stat: (uri: { fsPath: string }) => fs.promises.stat(uri.fsPath),
		},
	},
	Uri: {
		file: (filePath: string) => ({ fsPath: filePath }),
		joinPath: (base: { fsPath: string }, suffix: string) => ({ fsPath: path.join(base.fsPath, suffix) }),
	},
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
	EventEmitter: class {
		event = vi.fn()
		fire = vi.fn()
		dispose = vi.fn()
	},
}))

let fixture: string
let workspace: string
let outside: string
let context: DiscoveryContext
let cache: CacheManager
let scanner: DirectoryScanner
let watcher: FileWatcher
let failures: FileFailureRegistry
let parser: any
let store: any
let points: Map<string, any>
let watchers: any[]

function makeProcessors(workspaceGitignore = ignore()) {
	const embedder = {
		rateLimitScope: "openai:discovery-test",
		createEmbeddings: vi.fn(async (texts: string[]) => ({ embeddings: texts.map(() => [1]) })),
	}
	const getContext = async () => context
	failures = new FileFailureRegistry()
	const generations = new GenerationAllocator(cache)
	const gate = new IndexWriteGate()
	scanner = new DirectoryScanner(
		embedder as any,
		store,
		parser,
		cache,
		workspaceGitignore,
		1,
		gate,
		generations,
		failures,
		getContext,
	)
	watcher = new FileWatcher(
		workspace,
		{} as any,
		cache,
		embedder as any,
		store,
		workspaceGitignore,
		1,
		parser,
		gate,
		generations,
		failures,
		getContext,
	)
}

beforeEach(async () => {
	fixture = await fs.promises.mkdtemp(path.join(os.tmpdir(), "roo-index-discovery-"))
	workspace = path.join(fixture, "workspace")
	outside = path.join(fixture, "outside")
	await fs.promises.mkdir(workspace)
	await fs.promises.mkdir(outside)
	await fs.promises.writeFile(path.join(workspace, ".rooInclude"), outside)
	context = await createDiscoveryContext(workspace)
	cache = new CacheManager({ globalStorageUri: { fsPath: fixture } } as any, workspace)
	points = new Map()
	store = {
		rateLimitScope: "qdrant:discovery-test",
		upsertPoints: vi.fn(async (batch) => {
			for (const point of batch) points.set(point.id, point)
		}),
		deletePointsByFilePath: vi.fn(async (filePath, generation) => {
			for (const [identifier, point] of points) {
				if (
					point.payload.filePath === toIndexPath(filePath, workspace) &&
					point.payload.generation < generation
				)
					points.delete(identifier)
			}
		}),
		countPointsForFile: vi.fn(async (filePath, generation) => {
			const selected = [...points.values()].filter(
				(point) => point.payload.filePath === toIndexPath(filePath, workspace),
			)
			return {
				current: selected.filter((point) => point.payload.generation === generation).length,
				other: selected.filter((point) => point.payload.generation !== generation).length,
			}
		}),
	}
	parser = {
		parseFile: vi.fn(async (filePath, { content, fileHash }) => [
			{
				file_path: filePath,
				content,
				fileHash,
				segmentHash: `${filePath}:${fileHash}`,
				start_line: 1,
				end_line: 1,
				identifier: null,
				type: "function",
			},
		]),
	}
	watchers = []
	vi.mocked(vscode.workspace.createFileSystemWatcher).mockImplementation(() => {
		const created = { onDidCreate: vi.fn(), onDidChange: vi.fn(), onDidDelete: vi.fn(), dispose: vi.fn() }
		watchers.push(created)
		return created as any
	})
	makeProcessors()
})

afterEach(async () => {
	watcher.dispose()
	await cache.flush()
	await fs.promises.rm(fixture, { recursive: true, force: true })
	vi.clearAllMocks()
})

it("does not repeat listing's real-path access checks during the scan", async () => {
	const visible = path.join(workspace, "visible.ts")
	await fs.promises.writeFile(visible, "export const value = 1")
	context.includedRoots = []
	context.rooIgnore.add("secret/")
	const matcher = vi.spyOn(context.rooIgnore, "ignores")
	vi.mocked(listFiles).mockResolvedValue([[visible], false, []])
	await scanner.scanDirectory(workspace)
	expect(matcher).not.toHaveBeenCalled()
	expect(parser.parseFile).toHaveBeenCalledOnce()
	matcher.mockRestore()
})

it("scan and watcher block a real link to a blocked folder with defaults and no inclusions", async () => {
	await fs.promises.unlink(path.join(workspace, ".rooInclude"))
	const secret = path.join(workspace, "secret")
	await fs.promises.mkdir(secret)
	await fs.promises.writeFile(path.join(secret, "file.ts"), "blocked")
	const alias = path.join(workspace, "alias")
	await fs.promises.symlink(secret, alias, "dir")
	expect((await fs.promises.lstat(alias)).isSymbolicLink()).toBe(true)
	const visible = path.join(workspace, "visible.ts")
	await fs.promises.writeFile(visible, "export const value = 1")
	context = await createDiscoveryContext(workspace, { respectGitignore: true, followSymlinks: false }, "secret/")
	expect(context.includedRoots).toEqual([])
	const linkedFile = path.join(alias, "file.ts")
	vi.mocked(listFiles).mockResolvedValue([[linkedFile, visible], false])
	await scanner.scanDirectory(workspace)
	expect(parser.parseFile.mock.calls.map(([filePath]: [string]) => filePath)).toEqual([visible])
	parser.parseFile.mockClear()
	await watcher.processFile(linkedFile)
	expect(parser.parseFile).not.toHaveBeenCalled()
	expect([...points.values()].map((point) => point.payload.filePath)).toEqual(["visible.ts"])
})

it.each([true, false])("scan and watcher agree on included top-level Git rules (%s)", async (respectGitignore) => {
	await fs.promises.writeFile(path.join(outside, ".gitignore"), "ignored.ts\nignored-folder/\n")
	await fs.promises.mkdir(path.join(outside, "nested"))
	await fs.promises.writeFile(path.join(outside, "nested", ".gitignore"), "visible.ts\n")
	const files = ["ignored.ts", "ignored-folder/file.ts", "nested/visible.ts", "allowed.ts"].map((relative) =>
		path.join(outside, relative),
	)
	for (const filePath of files) {
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
		await fs.promises.writeFile(filePath, "export const value = 1")
	}
	context = await createDiscoveryContext(workspace, { respectGitignore, followSymlinks: false })
	vi.mocked(listFiles).mockResolvedValue([files, false])
	await scanner.scanDirectory(workspace)
	const scanned = parser.parseFile.mock.calls.map(([filePath]: [string]) => filePath).sort()
	parser.parseFile.mockClear()
	for (const filePath of files) {
		await fs.promises.writeFile(filePath, "export const value = 2")
		await watcher.processFile(filePath)
	}
	expect(parser.parseFile.mock.calls.map(([filePath]: [string]) => filePath).sort()).toEqual(scanned)
	expect(scanned).toEqual((respectGitignore ? files.slice(2) : files).sort())
	expect(listFiles).toHaveBeenCalledWith(workspace, true, expect.any(Number), context)
})

it.each([true, false])(
	"scan and watcher enforce access for workspace, hidden and outside roots (%s)",
	async (respectGitignore) => {
		const hidden = path.join(workspace, ".roo")
		await fs.promises.mkdir(hidden)
		await fs.promises.writeFile(path.join(workspace, ".rooInclude"), `${hidden}\n${outside}`)
		context = await createDiscoveryContext(
			workspace,
			{ respectGitignore, followSymlinks: true },
			"blocked.ts\nsecret/\n",
		)
		const files: string[] = []
		for (const root of [workspace, hidden, outside]) {
			for (const relative of ["allowed.ts", "blocked.ts", "secret/file.ts"]) {
				const filePath = path.join(root, relative)
				await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
				await fs.promises.writeFile(filePath, "export const value = 1")
				files.push(filePath)
			}
		}
		vi.mocked(listFiles).mockResolvedValue([files, false])
		await scanner.scanDirectory(workspace)
		expect(parser.parseFile.mock.calls.map(([filePath]: [string]) => filePath).sort()).toEqual(
			[workspace, hidden, outside].map((root) => path.join(root, "allowed.ts")).sort(),
		)
		parser.parseFile.mockClear()
		for (const filePath of files.filter((filePath) => !filePath.endsWith("allowed.ts")))
			await watcher.processFile(filePath)
		expect(parser.parseFile).not.toHaveBeenCalled()
	},
)

it("uses one outside key through scan, watched replacement, failure, deletion and removed inclusion", async () => {
	const filePath = path.join(outside, "sample.ts")
	await fs.promises.writeFile(filePath, "export const value = 1")
	vi.mocked(listFiles).mockResolvedValue([[filePath], false])
	await scanner.scanDirectory(workspace)
	expect([...points.values()].map((point) => point.payload.filePath)).toEqual([filePath])
	expect(cache.getAllHashes()).toHaveProperty(filePath)
	await fs.promises.writeFile(filePath, "export const value = 2")
	expect((await watcher.processFile(filePath)).status).toBe("success")
	expect([...points.values()].map((point) => point.payload.codeChunk)).toEqual(["export const value = 2"])
	parser.parseFile.mockRejectedValueOnce(new Error("parse failed"))
	await fs.promises.writeFile(filePath, "export const value = 3")
	expect((await watcher.processFile(filePath)).status).toBe("local_error")
	expect(failures.list()[0].path).toBe(filePath)
	await watcher.initialize()
	await fs.promises.unlink(filePath)
	watchers[1].onDidDelete.mock.calls[0][0]({ fsPath: filePath })
	await new Promise((resolve) => setTimeout(resolve, 600))
	expect(points.size).toBe(0)
	expect(cache.getTrackedPaths()).toEqual([])
	expect(failures.list()).toEqual([])
	await fs.promises.writeFile(filePath, "export const value = 4")
	await scanner.scanDirectory(workspace)
	vi.mocked(listFiles).mockResolvedValue([[], false])
	await scanner.scanDirectory(workspace)
	expect(points.size).toBe(0)
	expect(cache.getTrackedPaths()).toEqual([])
})

it("fails closed when the access matcher throws", async () => {
	const filePath = path.join(outside, "sample.ts")
	context.rooIgnore.ignores = () => {
		throw new Error("matcher failed")
	}
	vi.mocked(listFiles).mockResolvedValue([[filePath], false])
	await scanner.scanDirectory(workspace)
	await watcher.processFile(filePath)
	expect(parser.parseFile).not.toHaveBeenCalled()
})

it("walks startup directory links once without descending links and skips excluded folders", async () => {
	const target = path.join(fixture, "target")
	await fs.promises.mkdir(target)
	await fs.promises.symlink(outside, path.join(target, "nested-link"), "junction")
	for (const directory of ["ordinary", "node_modules", ".hidden", "blocked", "git-ignored"]) {
		const root = path.join(workspace, directory)
		await fs.promises.mkdir(root)
		await fs.promises.symlink(target, path.join(root, "linked"), "junction")
	}
	context = await createDiscoveryContext(workspace, { respectGitignore: true, followSymlinks: true }, "blocked/\n")
	const workspaceGitignore = ignore().add("git-ignored/\n")
	const links = await findStartupDirectoryLinks(context, workspaceGitignore)
	expect(links).toEqual([path.join(workspace, "ordinary", "linked")])
	context.options.respectGitignore = false
	expect((await findStartupDirectoryLinks(context, workspaceGitignore)).sort()).toEqual(
		[path.join(workspace, "ordinary", "linked"), path.join(workspace, "git-ignored", "linked")].sort(),
	)
	watcher.dispose()
	makeProcessors(workspaceGitignore)
	await watcher.initialize()
	expect(
		vi
			.mocked(vscode.RelativePattern)
			.mock.calls.slice(-4)
			.map(([root]) => root)
			.sort(),
	).toEqual([workspace, outside, ...(await findStartupDirectoryLinks(context, workspaceGitignore))].sort())
	watcher.dispose()
	for (const created of watchers) expect(created.dispose).toHaveBeenCalledOnce()
})

it("does not walk links with the feature disabled", async () => {
	const read = vi.spyOn(fs.promises, "readdir")
	expect(await findStartupDirectoryLinks(context)).toEqual([])
	expect(read).not.toHaveBeenCalled()
	read.mockRestore()
})

it.each([true, false])(
	"workspace Git eligibility and access through link aliases agree (%s)",
	async (respectGitignore) => {
		const blocked = path.join(workspace, "blocked")
		const allowed = path.join(workspace, "allowed")
		await fs.promises.mkdir(blocked)
		await fs.promises.mkdir(allowed)
		await fs.promises.writeFile(path.join(blocked, "file.ts"), "blocked")
		await fs.promises.writeFile(path.join(allowed, "file.ts"), "allowed")
		await fs.promises.symlink(blocked, path.join(workspace, "alias"), "junction")
		await fs.promises.symlink(allowed, path.join(workspace, "denied-alias"), "junction")
		const gitFile = path.join(workspace, "git-file.ts")
		await fs.promises.writeFile(gitFile, "ignored by Git")
		context = await createDiscoveryContext(
			workspace,
			{ respectGitignore, followSymlinks: true },
			"blocked/\ndenied-alias/\n",
		)
		watcher.dispose()
		makeProcessors(ignore().add("git-file.ts"))
		const files = [
			path.join(workspace, "alias", "file.ts"),
			path.join(workspace, "denied-alias", "file.ts"),
			gitFile,
		]
		vi.mocked(listFiles).mockResolvedValue([files, false])
		await scanner.scanDirectory(workspace)
		expect(parser.parseFile.mock.calls.map(([filePath]: [string]) => filePath)).toEqual(
			respectGitignore ? [] : [gitFile],
		)
		parser.parseFile.mockClear()
		await fs.promises.writeFile(gitFile, "changed")
		for (const filePath of files) await watcher.processFile(filePath)
		expect(parser.parseFile.mock.calls.map(([filePath]: [string]) => filePath)).toEqual(
			respectGitignore ? [] : [gitFile],
		)
	},
)

it("retains its discovery snapshot until indexing restarts", async () => {
	const filePath = path.join(outside, "sample.ts")
	await fs.promises.writeFile(filePath, "export const value = 1")
	const getContext = vi.fn(async () => context)
	watcher.dispose()
	watcher = new FileWatcher(
		workspace,
		{} as any,
		cache,
		undefined,
		store,
		ignore(),
		1,
		parser,
		undefined,
		undefined,
		failures,
		getContext,
	)
	await watcher.initialize()
	await fs.promises.writeFile(path.join(workspace, ".rooInclude"), "")
	await fs.promises.writeFile(path.join(workspace, ".rooignore"), "sample.ts")
	await watcher.processFile(filePath)
	expect(getContext).toHaveBeenCalledOnce()
	expect(watchers).toHaveLength(2)
})

it("persists normalized keys and migrates legacy absolute workspace cache entries", async () => {
	const filePath = path.join(workspace, "sample.ts")
	const outsidePath = path.join(outside, "sample.ts")
	const read = vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValueOnce(
		Buffer.from(
			JSON.stringify({
				version: 2,
				fileHashes: { [filePath]: "old", [outsidePath]: "outside" },
				openFiles: {},
			}),
		),
	)
	await cache.initialize()
	expect(cache.getAllHashes()).toEqual({ "sample.ts": "old", [outsidePath]: "outside" })
	expect(cache.getHash(filePath)).toBe("old")
	await cache.invalidateFile(filePath)
	expect(cache.getOpenFiles()).toEqual({ [filePath]: true })
	expect(safeWriteJson).toHaveBeenLastCalledWith(
		expect.any(String),
		expect.objectContaining({
			fileHashes: { [outsidePath]: "outside" },
			openFiles: { "sample.ts": true },
		}),
	)
	read.mockRestore()
})
