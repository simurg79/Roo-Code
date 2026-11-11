import path from "node:path"
import { FileIndexWriter } from "../file-completion"
import { FileFailureRegistry } from "../file-failure-registry"
import { IndexWriteGate } from "../index-write-gate"
import { ProviderPacerRegistry } from "../provider-pacer"
import type { CacheManager } from "../cache-manager"
import type { GenerationAllocator } from "../generation-allocator"
import type { IEmbedder, IVectorStore, CodeBlock } from "../interfaces"

export function transportWriter(store?: IVectorStore) {
	const workspace = path.resolve("/workspace")
	const file = path.join(workspace, "test.ts")
	const failures = new FileFailureRegistry()
	const pacers = new ProviderPacerRegistry()
	const cache = {
		invalidateFile: vi.fn().mockResolvedValue(undefined),
		completeFile: vi.fn(),
		completeRemoval: vi.fn(),
	}
	const vectorStore =
		store ??
		({
			rateLimitScope: "qdrant:test",
			upsertPoints: vi.fn().mockResolvedValue(undefined),
			deletePointsByFilePath: vi.fn().mockResolvedValue(undefined),
			countPointsForFile: vi.fn().mockResolvedValue({ current: 1, other: 0 }),
		} as unknown as IVectorStore)
	const writer = new FileIndexWriter(
		cache as unknown as CacheManager,
		vectorStore,
		new IndexWriteGate(),
		{ allocate: async () => 1 } as unknown as GenerationAllocator,
		workspace,
		failures,
		pacers,
	)
	const block: CodeBlock = {
		file_path: file,
		identifier: null,
		type: "function",
		start_line: 1,
		end_line: 1,
		content: "test",
		fileHash: "revision",
		segmentHash: "segment",
	}
	return {
		writer,
		failures,
		pacers,
		cache,
		file,
		replace: (embedder: IEmbedder, signal = new AbortController().signal) =>
			writer.replace(file, "revision", [block], embedder, signal),
	}
}
