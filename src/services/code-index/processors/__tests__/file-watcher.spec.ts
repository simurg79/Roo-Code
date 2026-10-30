// npx vitest services/code-index/processors/__tests__/file-watcher.spec.ts

import * as vscode from "vscode"

import { FileWatcher } from "../file-watcher"
import { ParserFatalError } from "../../parser-errors"

// Mock dependencies
vi.mock("../../cache-manager")
vi.mock("../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: vi.fn().mockImplementation(() => ({
		validateAccess: vi.fn().mockReturnValue(true),
	})),
}))
vi.mock("ignore")
vi.mock("../parser", () => ({
	codeParser: {
		parseFile: vi.fn().mockResolvedValue([]),
	},
}))
vi.mock("../../../glob/ignore-utils", () => ({
	isPathInIgnoredDirectory: vi.fn().mockReturnValue(false),
}))

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(),
		workspaceFolders: [
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		],
		fs: {
			stat: vi.fn().mockResolvedValue({ size: 1000 }),
			readFile: vi.fn().mockResolvedValue(Buffer.from("test content")),
		},
	},
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
	Uri: {
		file: vi.fn().mockImplementation((path) => ({ fsPath: path })),
	},
	EventEmitter: vi.fn().mockImplementation(() => ({
		event: vi.fn(),
		fire: vi.fn(),
		dispose: vi.fn(),
	})),
	ExtensionContext: vi.fn(),
}))

describe("FileWatcher", () => {
	let fileWatcher: FileWatcher
	let mockWatcher: any
	let mockOnDidCreate: any
	let mockOnDidChange: any
	let mockOnDidDelete: any
	let mockContext: any
	let mockCacheManager: any
	let mockEmbedder: any
	let mockVectorStore: any
	let mockIgnoreInstance: any

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Create mock event handlers
		mockOnDidCreate = vi.fn()
		mockOnDidChange = vi.fn()
		mockOnDidDelete = vi.fn()

		// Create mock watcher
		mockWatcher = {
			onDidCreate: vi.fn().mockImplementation((handler) => {
				mockOnDidCreate = handler
				return { dispose: vi.fn() }
			}),
			onDidChange: vi.fn().mockImplementation((handler) => {
				mockOnDidChange = handler
				return { dispose: vi.fn() }
			}),
			onDidDelete: vi.fn().mockImplementation((handler) => {
				mockOnDidDelete = handler
				return { dispose: vi.fn() }
			}),
			dispose: vi.fn(),
		}

		// Mock createFileSystemWatcher to return our mock watcher
		vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(mockWatcher)

		// Create mock dependencies
		mockContext = {
			subscriptions: [],
		}

		mockCacheManager = {
			getHash: vi.fn(),
			updateHash: vi.fn(),
			deleteHash: vi.fn(),
		}

		mockEmbedder = {
			createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
		}

		mockVectorStore = {
			upsertPoints: vi.fn().mockResolvedValue(undefined),
			deletePointsByFilePath: vi.fn().mockResolvedValue(undefined),
			deletePointsByMultipleFilePaths: vi.fn().mockResolvedValue(undefined),
		}

		mockIgnoreInstance = {
			ignores: vi.fn().mockReturnValue(false),
		}

		fileWatcher = new FileWatcher(
			"/mock/workspace",
			mockContext,
			mockCacheManager,
			mockEmbedder,
			mockVectorStore,
			mockIgnoreInstance,
			undefined,
			undefined,
			{ parseFile: vi.fn().mockResolvedValue([]) },
		)
	})

	describe("attempt ownership", () => {
		function createWatcher(parser: any, signal?: AbortSignal) {
			const watcher = new FileWatcher(
				"/mock/workspace",
				mockContext,
				mockCacheManager,
				mockEmbedder,
				mockVectorStore,
				mockIgnoreInstance,
				{ validateAccess: () => true } as any,
				1,
				parser,
			)
			return { watcher, initialize: () => watcher.initialize(signal) }
		}

		it("reports a fatal parser once, disposes events, and starts no more queued files", async () => {
			const fatal = new ParserFatalError("parser-abort", "/mock/workspace/bad.ts")
			const parser = { parseFile: vi.fn().mockRejectedValue(fatal) }
			const { watcher, initialize } = createWatcher(parser)
			await initialize()
			const report = vi.spyOn((watcher as any).parserFatal, "fire")
			await expect(watcher.processFile("/mock/workspace/bad.ts")).rejects.toBe(fatal)
			expect(report).toHaveBeenCalledOnce()
			expect(mockWatcher.dispose).toHaveBeenCalledOnce()
			await mockOnDidChange({ fsPath: "/mock/workspace/next.ts" })
			await (watcher as any).triggerBatchProcessing()
			expect(parser.parseFile).toHaveBeenCalledOnce()
			expect(mockVectorStore.upsertPoints).not.toHaveBeenCalled()
		})

		it("drops embeddings released after the attempt stops", async () => {
			const parser = {
				parseFile: vi.fn().mockResolvedValue([
					{
						file_path: "/mock/workspace/file.ts",
						content: "function test() {}",
						start_line: 1,
						end_line: 1,
					},
				]),
			}
			const controller = new AbortController()
			const { watcher, initialize } = createWatcher(parser, controller.signal)
			await initialize()
			let release!: (value: any) => void
			mockEmbedder.createEmbeddings.mockImplementation(
				() =>
					new Promise((resolve) => {
						release = resolve
					}),
			)
			const pending = (watcher as any)
				.processBatch(new Map([["file", { uri: { fsPath: "/mock/workspace/file.ts" }, type: "change" }]]))
				.catch((error: Error) => error)
			await vi.waitFor(() => expect(mockEmbedder.createEmbeddings).toHaveBeenCalledOnce())
			controller.abort()
			watcher.dispose()
			release({ embeddings: [[1, 2, 3]] })
			await pending
			expect(mockVectorStore.upsertPoints).not.toHaveBeenCalled()
			expect(mockVectorStore.deletePointsByFilePath).not.toHaveBeenCalled()
			expect(mockCacheManager.updateHash).not.toHaveBeenCalled()
		})

		it.each(["fatal", "cancel", "disable"])(
			"a replacement watcher processes scan-following changes after %s",
			async () => {
				const parser = {
					parseFile: vi.fn().mockResolvedValue([
						{
							file_path: "/mock/workspace/file.ts",
							content: "function test() {}",
							start_line: 1,
							end_line: 1,
						},
					]),
				}
				const old = createWatcher(parser)
				await old.initialize()
				old.watcher.dispose()
				const replacement = createWatcher(parser)
				await replacement.initialize()
				await mockOnDidChange({ fsPath: "/mock/workspace/file.ts" })
				await (replacement.watcher as any).triggerBatchProcessing()
				expect(mockVectorStore.upsertPoints).toHaveBeenCalledOnce()
				expect(mockCacheManager.updateHash).toHaveBeenCalledOnce()
				expect((replacement.watcher as any)._onBatchProgressUpdate.fire).toHaveBeenCalled()
				expect(mockVectorStore.deletePointsByFilePath.mock.invocationCallOrder[0]).toBeLessThan(
					mockVectorStore.upsertPoints.mock.invocationCallOrder[0],
				)
				replacement.watcher.dispose()
			},
		)
	})

	describe("file filtering", () => {
		it("should ignore files in hidden directories on create events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Spy on the vector store to see which files are actually processed
			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async (points: any[]) => {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			// Simulate file creation events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.git/config", shouldProcess: false },
				{ path: "/mock/workspace/.hidden/file.ts", shouldProcess: false },
				{ path: "/mock/workspace/src/.next/static/file.js", shouldProcess: false },
				{ path: "/mock/workspace/node_modules/package/index.js", shouldProcess: false },
				{ path: "/mock/workspace/normal/file.js", shouldProcess: true },
			]

			// Trigger file creation events
			for (const { path } of testCases) {
				await mockOnDidCreate({ fsPath: path })
			}

			// Wait for batch processing
			await new Promise((resolve) => setTimeout(resolve, 600))

			// Check that files in hidden directories were not processed
			expect(processedFiles).not.toContain("src/.next/static/file.js")
			expect(processedFiles).not.toContain(".git/config")
			expect(processedFiles).not.toContain(".hidden/file.ts")
		})

		it("should ignore files in hidden directories on change events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Track which files are processed
			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async (points: any[]) => {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			// Simulate file change events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.vscode/settings.json", shouldProcess: false },
				{ path: "/mock/workspace/src/.cache/data.json", shouldProcess: false },
				{ path: "/mock/workspace/dist/bundle.js", shouldProcess: false },
			]

			// Trigger file change events
			for (const { path } of testCases) {
				await mockOnDidChange({ fsPath: path })
			}

			// Wait for batch processing
			await new Promise((resolve) => setTimeout(resolve, 600))

			// Check that files in hidden directories were not processed
			expect(processedFiles).not.toContain(".vscode/settings.json")
			expect(processedFiles).not.toContain("src/.cache/data.json")
		})

		it("should ignore files in hidden directories on delete events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Track which files are deleted
			const deletedFiles: string[] = []
			mockVectorStore.deletePointsByFilePath.mockImplementation(async (filePath: string) => {
				deletedFiles.push(filePath)
			})

			// Simulate file deletion events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.git/objects/abc123", shouldProcess: false },
				{ path: "/mock/workspace/.DS_Store", shouldProcess: false },
				{ path: "/mock/workspace/build/.cache/temp.js", shouldProcess: false },
			]

			// Trigger file deletion events
			for (const { path } of testCases) {
				await mockOnDidDelete({ fsPath: path })
			}

			// Wait for batch processing
			await new Promise((resolve) => setTimeout(resolve, 600))

			// Check that files in hidden directories were not processed
			expect(deletedFiles).not.toContain(".git/objects/abc123")
			expect(deletedFiles).not.toContain(".DS_Store")
			expect(deletedFiles).not.toContain("build/.cache/temp.js")
		})

		it("should handle nested hidden directories correctly", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Track which files are processed
			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async (points: any[]) => {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			// Test deeply nested hidden directories
			const testCases = [
				{ path: "/mock/workspace/src/components/Button.tsx", shouldProcess: true },
				{ path: "/mock/workspace/src/.hidden/components/Button.tsx", shouldProcess: false },
				{ path: "/mock/workspace/.hidden/src/components/Button.tsx", shouldProcess: false },
				{ path: "/mock/workspace/src/components/.hidden/Button.tsx", shouldProcess: false },
			]

			// Trigger file creation events
			for (const { path } of testCases) {
				await mockOnDidCreate({ fsPath: path })
			}

			// Wait for batch processing
			await new Promise((resolve) => setTimeout(resolve, 600))

			// Check that files in hidden directories were not processed
			expect(processedFiles).not.toContain("src/.hidden/components/Button.tsx")
			expect(processedFiles).not.toContain(".hidden/src/components/Button.tsx")
			expect(processedFiles).not.toContain("src/components/.hidden/Button.tsx")
		})
	})

	describe("dispose", () => {
		it("should dispose of the watcher when disposed", async () => {
			await fileWatcher.initialize()
			fileWatcher.dispose()

			expect(mockWatcher.dispose).toHaveBeenCalled()
		})
	})
})
