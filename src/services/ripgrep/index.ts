import * as childProcess from "child_process"
import * as path from "path"
import * as readline from "readline"

import * as vscode from "vscode"

import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import { fileExistsAtPath } from "../../utils/fs"
import { buildIncludedRootArgs } from "../glob/list-files"
import {
	createDiscoveryContext,
	getIncludedRoot,
	isDiscoveryPathAllowed,
	isIncludedRootGitEligible,
	isUnderRoot,
	type IncludedRoot,
} from "../glob/discovery-options"
/*
This file provides functionality to perform regex searches on files using ripgrep.
Inspired by: https://github.com/DiscreteTom/vscode-ripgrep-utils

Key components:
1. getBinPath: Locates the ripgrep binary within the VSCode installation.
2. execRipgrep: Executes the ripgrep command and returns the output.
3. regexSearchFiles: The main function that performs regex searches on files.
   - Parameters:
     * cwd: The current working directory (for relative path calculation)
     * directoryPath: The directory to search in
     * regex: The regular expression to search for (Rust regex syntax)
     * filePattern: Optional glob pattern to filter files (default: '*')
   - Returns: A formatted string containing search results with context

The search results include:
- Relative file paths
- 2 lines of context before and after each match
- Matches formatted with pipe characters for easy reading

Usage example:
const results = await regexSearchFiles('/path/to/cwd', '/path/to/search', 'TODO:', '*.ts');

rel/path/to/app.ts
│----
│function processData(data: any) {
│  // Some processing logic here
│  // TODO: Implement error handling
│  return processedData;
│}
│----

rel/path/to/helper.ts
│----
│  let result = 0;
│  for (let i = 0; i < input; i++) {
│    // TODO: Optimize this function for performance
│    result += Math.pow(i, 2);
│  }
│----
*/

const isWindows = process.platform.startsWith("win")
const binName = isWindows ? "rg.exe" : "rg"

// VS Code's @vscode/ripgrep-universal package (used by recent VS Code builds,
// including the Insiders staged-install layout) nests the binary under
// bin/<platform>-<arch>/ rather than directly in bin/.
const ripgrepUniversalBinDir = `bin/${process.platform}-${process.arch}`

interface SearchFileResult {
	file: string
	searchResults: SearchResult[]
}

interface SearchResult {
	lines: SearchLineResult[]
}

interface SearchLineResult {
	line: number
	text: string
	isMatch: boolean
	column?: number
}
// Constants
const MAX_RESULTS = 300
const MAX_LINE_LENGTH = 500

/**
 * Truncates a line if it exceeds the maximum length
 * @param line The line to truncate
 * @param maxLength The maximum allowed length (defaults to MAX_LINE_LENGTH)
 * @returns The truncated line, or the original line if it's shorter than maxLength
 */
export function truncateLine(line: string, maxLength: number = MAX_LINE_LENGTH): string {
	return line.length > maxLength ? line.substring(0, maxLength) + " [truncated...]" : line
}
/**
 * Get the path to the ripgrep binary shipped inside the VS Code installation.
 *
 * Both the long-standing `@vscode/ripgrep` layout and the newer
 * `@vscode/ripgrep-universal` layout are checked — the latter is what VS Code
 * Insiders' staged-install builds use (see microsoft/vscode#252063).
 *
 * Returns `undefined` when ripgrep cannot be located.
 */
export async function getBinPath(vscodeAppRoot: string): Promise<string | undefined> {
	const checkPath = async (pkgFolder: string) => {
		const fullPath = path.join(vscodeAppRoot, pkgFolder, binName)
		return (await fileExistsAtPath(fullPath)) ? fullPath : undefined
	}

	return (
		(await checkPath("node_modules/@vscode/ripgrep/bin/")) ||
		(await checkPath("node_modules/vscode-ripgrep/bin")) ||
		(await checkPath("node_modules.asar.unpacked/vscode-ripgrep/bin/")) ||
		(await checkPath("node_modules.asar.unpacked/@vscode/ripgrep/bin/")) ||
		(await checkPath(`node_modules/@vscode/ripgrep-universal/${ripgrepUniversalBinDir}`)) ||
		(await checkPath(`node_modules.asar.unpacked/@vscode/ripgrep-universal/${ripgrepUniversalBinDir}`))
	)
}

async function execRipgrep(
	bin: string,
	args: string[],
	allowed: (file: string) => boolean,
	cwd?: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const rgProcess = cwd ? childProcess.spawn(bin, args, { cwd }) : childProcess.spawn(bin, args)
		// cross-platform alternative to head, which is ripgrep author's recommendation for limiting output.
		const rl = readline.createInterface({
			input: rgProcess.stdout,
			crlfDelay: Infinity, // treat \r\n as a single line break even if it's split across chunks. This ensures consistent behavior across different operating systems.
		})

		let output = ""
		let lineCount = 0
		const maxLines = MAX_RESULTS * 5
		let fileAllowed = false
		const timeout = setTimeout(() => rgProcess.kill(), 10_000)

		rl.on("line", (line) => {
			try {
				const event = JSON.parse(line)
				if (event.type === "begin") fileAllowed = allowed(event.data.path.text)
			} catch {
				return
			}
			// Blocked files must not consume the bounded output budget.
			if (!fileAllowed) return
			if (lineCount < maxLines) {
				output += line + "\n"
				lineCount++
			} else {
				rl.close()
				rgProcess.kill()
			}
		})

		let errorOutput = ""
		rgProcess.stderr.on("data", (data) => {
			errorOutput += data.toString()
		})
		rgProcess.on("close", () => {
			clearTimeout(timeout)
			if (errorOutput) {
				reject(new Error(`ripgrep process error: ${errorOutput}`))
			} else {
				resolve(output)
			}
		})
		rgProcess.on("error", (error) => {
			clearTimeout(timeout)
			reject(new Error(`ripgrep process error: ${error.message}`))
		})
	})
}

export async function regexSearchFiles(
	cwd: string,
	directoryPath: string,
	regex: string,
	filePattern?: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<string> {
	const vscodeAppRoot = vscode.env.appRoot
	const rgPath = await getBinPath(vscodeAppRoot)

	if (!rgPath) {
		throw new Error("Could not find ripgrep binary")
	}

	const workspaceRoot = path.resolve(cwd)
	const absoluteTarget = path.resolve(directoryPath)
	const context = await createDiscoveryContext(workspaceRoot, undefined, rooIgnoreController?.rooIgnoreContent)
	const legacyOutsideRequest =
		!isUnderRoot(absoluteTarget, workspaceRoot) && !getIncludedRoot(absoluteTarget, context)
	if (!legacyOutsideRequest && !isDiscoveryPathAllowed(`${absoluteTarget}/`, context)) return formatResults([], cwd)

	const args = ["--json", "-e", regex]

	// Only add --glob if a specific file pattern is provided
	// Using --glob "*" overrides .gitignore behavior, so we omit it when no pattern is specified
	if (filePattern) {
		args.push("--glob", filePattern)
	}

	args.push("--context", "1", "--no-messages")
	const requestedRoot = getIncludedRoot(absoluteTarget, context)
	const searches: { target: string; root?: IncludedRoot }[] = [{ target: absoluteTarget, root: requestedRoot }]
	if (path.relative(workspaceRoot, absoluteTarget) === "") {
		for (const root of context.includedRoots) {
			if (root !== requestedRoot) searches.push({ target: root.root, root })
		}
	}

	const merged = new Map<string, SearchFileResult>()
	for (const search of searches) {
		const resolveFile = (file: string) => path.resolve(search.root?.root ?? workspaceRoot, file)
		const allowed = (file: string) => {
			const absolutePath = resolveFile(file)
			const root = search.root ?? getIncludedRoot(absolutePath, context)
			if (legacyOutsideRequest) return rooIgnoreController?.validateAccess(absolutePath) ?? true
			return (
				isDiscoveryPathAllowed(absolutePath, context) &&
				(!root || isIncludedRootGitEligible(absolutePath, root, context.options))
			)
		}
		const traversalArgs = search.root
			? buildIncludedRootArgs(path.relative(search.root.root, search.target) || ".", context.options)
			: [
					...(context.options.followSymlinks ? ["--follow"] : []),
					...(!context.options.respectGitignore ? ["--no-ignore-vcs"] : []),
					directoryPath,
				]
		try {
			const output = await execRipgrep(rgPath, [...args, ...traversalArgs], allowed, search.root?.root)
			for (const result of parseRipgrepOutput(output)) {
				const absolutePath = resolveFile(result.file)
				if (allowed(result.file) && !merged.has(absolutePath)) {
					merged.set(absolutePath, { ...result, file: absolutePath })
				}
			}
		} catch (error) {
			console.error("Error executing ripgrep:", error)
			if (searches.length === 1) return "No results found"
		}
	}
	return formatResults([...merged.values()], cwd)
}

function parseRipgrepOutput(output: string): SearchFileResult[] {
	const results: SearchFileResult[] = []
	let currentFile: SearchFileResult | null = null

	output.split("\n").forEach((line) => {
		if (line) {
			try {
				const parsed = JSON.parse(line)
				if (parsed.type === "begin") {
					currentFile = {
						file: parsed.data.path.text.toString(),
						searchResults: [],
					}
				} else if (parsed.type === "end") {
					// Reset the current result when a new file is encountered
					results.push(currentFile as SearchFileResult)
					currentFile = null
				} else if ((parsed.type === "match" || parsed.type === "context") && currentFile) {
					const line = {
						line: parsed.data.line_number,
						text: truncateLine(parsed.data.lines.text),
						isMatch: parsed.type === "match",
						...(parsed.type === "match" && { column: parsed.data.absolute_offset }),
					}

					const lastResult = currentFile.searchResults[currentFile.searchResults.length - 1]
					if (lastResult?.lines.length > 0) {
						const lastLine = lastResult.lines[lastResult.lines.length - 1]

						// If this line is contiguous with the last result, add to it
						if (parsed.data.line_number <= lastLine.line + 1) {
							lastResult.lines.push(line)
						} else {
							// Otherwise create a new result
							currentFile.searchResults.push({
								lines: [line],
							})
						}
					} else {
						// First line in file
						currentFile.searchResults.push({
							lines: [line],
						})
					}
				}
			} catch (error) {
				console.error("Error parsing ripgrep output:", error)
			}
		}
	})

	if (currentFile) results.push(currentFile)
	return results
}

function formatResults(fileResults: SearchFileResult[], cwd: string): string {
	const groupedResults: { [key: string]: SearchResult[] } = {}

	let totalResults = fileResults.reduce((sum, file) => sum + file.searchResults.length, 0)
	let output = ""
	if (totalResults >= MAX_RESULTS) {
		output += `Showing first ${MAX_RESULTS} of ${MAX_RESULTS}+ results. Use a more specific search if necessary.\n\n`
	} else {
		output += `Found ${totalResults === 1 ? "1 result" : `${totalResults.toLocaleString()} results`}.\n\n`
	}

	// Group results by file name
	let remainingResults = MAX_RESULTS
	fileResults.slice(0, MAX_RESULTS).forEach((file) => {
		if (remainingResults === 0) return
		const relativeFilePath = path.relative(cwd, file.file)
		if (!groupedResults[relativeFilePath]) {
			groupedResults[relativeFilePath] = []

			const selected = file.searchResults.slice(0, remainingResults)
			groupedResults[relativeFilePath].push(...selected)
			remainingResults -= selected.length
		}
	})

	for (const [filePath, fileResults] of Object.entries(groupedResults)) {
		output += `# ${filePath.toPosix()}\n`

		fileResults.forEach((result) => {
			// Only show results with at least one line
			if (result.lines.length > 0) {
				// Show all lines in the result
				result.lines.forEach((line) => {
					const lineNumber = String(line.line).padStart(3, " ")
					output += `${lineNumber} | ${line.text.trimEnd()}\n`
				})
				output += "----\n"
			}
		})

		output += "\n"
	}

	return output.trim()
}
