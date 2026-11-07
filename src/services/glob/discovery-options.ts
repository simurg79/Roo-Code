import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import ignore, { type Ignore } from "ignore"
import { Package } from "../../shared/package"

export interface DiscoveryOptions {
	respectGitignore: boolean
	followSymlinks: boolean
}

export interface IncludedRoot {
	root: string
	ignoreBase: string
	gitignore: Ignore
}

export interface DiscoveryContext {
	workspaceRoot: string
	options: DiscoveryOptions
	includedRoots: IncludedRoot[]
	rooIgnore: Ignore
	hasRooIgnoreRules?: boolean
}

let outputChannel: vscode.OutputChannel | undefined

export function setDiscoveryOutputChannel(channel: vscode.OutputChannel): void {
	outputChannel = channel
}

export function getDiscoveryOptions(): DiscoveryOptions {
	const configuration = vscode.workspace.getConfiguration(Package.name)
	return {
		respectGitignore: configuration.get<boolean>("discovery.respectGitignore", true),
		followSymlinks: configuration.get<boolean>("discovery.followSymlinks", false),
	}
}

export function isUnderRoot(absolutePath: string, root: string): boolean {
	const relativePath = path.relative(root, absolutePath)
	return (
		relativePath === "" ||
		(!path.isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`))
	)
}

export function getIncludedRoot(absolutePath: string, context: DiscoveryContext): IncludedRoot | undefined {
	return context.includedRoots.find((included) => isUnderRoot(absolutePath, included.root))
}

export function discoveryRelativePath(absolutePath: string, context: DiscoveryContext): string {
	const root = isUnderRoot(absolutePath, context.workspaceRoot)
		? context.workspaceRoot
		: getIncludedRoot(absolutePath, context)?.ignoreBase
	return root ? path.relative(root, absolutePath) : absolutePath
}

export function isDiscoveryPathAllowed(absolutePath: string, context: DiscoveryContext): boolean {
	try {
		const directory = absolutePath.endsWith("/") || absolutePath.endsWith(path.sep)
		const aliasPath = path.resolve(absolutePath)
		const relativePath = discoveryRelativePath(aliasPath, context)
		if (path.isAbsolute(relativePath)) return false
		const matches = (candidate: string) => {
			const normalized = candidate.split(path.sep).join("/")
			return normalized !== "" && context.rooIgnore.ignores(directory ? `${normalized}/` : normalized)
		}
		if (matches(relativePath)) return false
		// Default listing follows links, so only known-empty rules can skip real-path checks.
		if (context.hasRooIgnoreRules === false) return true
		let realPath: string
		try {
			realPath = fs.realpathSync(aliasPath)
		} catch {
			return true
		}
		return !isUnderRoot(realPath, context.workspaceRoot) || !matches(path.relative(context.workspaceRoot, realPath))
	} catch {
		return false
	}
}

export function isIncludedRootGitEligible(
	absolutePath: string,
	root: IncludedRoot,
	options: DiscoveryOptions,
): boolean {
	if (!options.respectGitignore) return true
	try {
		const relativePath = path.relative(root.ignoreBase, absolutePath).split(path.sep).join("/")
		if (!relativePath) return true
		const directory = absolutePath.endsWith("/") || absolutePath.endsWith(path.sep)
		return !root.gitignore.ignores(directory ? `${relativePath}/` : relativePath)
	} catch {
		return false
	}
}

function warn(entry: string, reason: string): void {
	outputChannel?.appendLine(`[Discovery] Skipping ${entry}: ${reason.replace(/[\r\n]/g, " ")}`)
}

export async function readRooInclude(workspaceRoot: string, context?: DiscoveryContext): Promise<IncludedRoot[]> {
	const includePath = path.join(workspaceRoot, ".rooInclude")
	let content: string
	try {
		content = await fs.promises.readFile(includePath, "utf8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") warn(includePath, String(error))
		return []
	}
	const roots: IncludedRoot[] = []
	const seen = new Set<string>()
	for (const line of content.split(/\r?\n/)) {
		const entry = line.trim()
		if (!entry || entry.startsWith("#")) continue
		const root = path.resolve(workspaceRoot, entry)
		if (seen.has(root)) continue
		seen.add(root)
		try {
			if (!(await fs.promises.stat(root)).isDirectory()) {
				warn(entry, "not a directory")
				continue
			}
			const included = { root, ignoreBase: root, gitignore: ignore() }
			if (context && !isDiscoveryPathAllowed(`${root}/`, { ...context, includedRoots: [...roots, included] })) {
				warn(entry, "blocked by .rooignore")
				continue
			}
			try {
				included.gitignore.add(await fs.promises.readFile(path.join(root, ".gitignore"), "utf8"))
			} catch {
				// D10 permits unreadable Git rules to be skipped.
			}
			roots.push(included)
		} catch (error) {
			warn(entry, String(error))
		}
	}
	return roots
}

export async function createDiscoveryContext(
	workspaceRoot: string,
	options = getDiscoveryOptions(),
	rooIgnoreContent?: string,
): Promise<DiscoveryContext> {
	const rooIgnore = ignore()
	if (rooIgnoreContent === undefined) {
		try {
			rooIgnoreContent = await fs.promises.readFile(path.join(workspaceRoot, ".rooignore"), "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		}
	}
	if (rooIgnoreContent) rooIgnore.add(rooIgnoreContent).add(".rooignore")
	const context: DiscoveryContext = {
		workspaceRoot,
		options,
		rooIgnore,
		hasRooIgnoreRules: Boolean(rooIgnoreContent),
		includedRoots: [],
	}
	context.includedRoots = await readRooInclude(workspaceRoot, context)
	return context
}

export function toIndexPath(absolutePath: string, workspaceRoot: string): string {
	return isUnderRoot(absolutePath, workspaceRoot)
		? path.normalize(path.relative(workspaceRoot, absolutePath))
		: path.normalize(absolutePath)
}
