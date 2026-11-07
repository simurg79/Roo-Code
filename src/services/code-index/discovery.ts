import * as path from "path"
import { readdir, stat } from "fs/promises"
import type { Ignore } from "ignore"
import {
	discoveryRelativePath,
	getIncludedRoot,
	isDiscoveryPathAllowed,
	isIncludedRootGitEligible,
	type DiscoveryContext,
} from "../glob/discovery-options"
import { isPathInIgnoredDirectory } from "../glob/ignore-utils"
import { throwIfAborted } from "./parser-errors"

export function isIndexDiscoveryPathEligible(
	filePath: string,
	context: DiscoveryContext,
	workspaceGitignore?: Ignore,
	accessAlreadyChecked = false,
): boolean {
	if (!accessAlreadyChecked && !isDiscoveryPathAllowed(filePath, context)) return false
	const includedRoot = getIncludedRoot(filePath, context)
	const relativePath = includedRoot
		? path.relative(includedRoot.root, filePath)
		: discoveryRelativePath(filePath, context)
	if (isPathInIgnoredDirectory(relativePath)) return false
	if (!context.options.respectGitignore) return true
	if (includedRoot) return isIncludedRootGitEligible(filePath, includedRoot, context.options)
	try {
		const workspaceRelativePath = relativePath.split(path.sep).join("/")
		return !workspaceGitignore?.ignores(
			filePath.endsWith("/") ? `${workspaceRelativePath}/` : workspaceRelativePath,
		)
	} catch {
		return false
	}
}

export async function findStartupDirectoryLinks(
	context: DiscoveryContext,
	workspaceGitignore?: Ignore,
	signal?: AbortSignal,
): Promise<string[]> {
	const links: string[] = []
	if (!context.options.followSymlinks) return links
	const workspaceContext = { ...context, includedRoots: [] }
	const pending = [context.workspaceRoot]
	while (pending.length) {
		if (signal) throwIfAborted(signal)
		const directory = pending.pop()!
		let entries
		try {
			entries = await readdir(directory, { withFileTypes: true })
		} catch {
			continue
		}
		for (const entry of entries) {
			if (signal) throwIfAborted(signal)
			if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
			const entryPath = path.join(directory, entry.name)
			if (isPathInIgnoredDirectory(path.relative(context.workspaceRoot, entryPath))) continue
			if (!isIndexDiscoveryPathEligible(`${entryPath}/`, workspaceContext, workspaceGitignore)) continue
			if (entry.isSymbolicLink()) {
				try {
					if ((await stat(entryPath)).isDirectory()) links.push(entryPath)
				} catch {
					// Broken or inaccessible links cannot supply a watcher root.
				}
			} else {
				pending.push(entryPath)
			}
		}
	}
	return links
}
