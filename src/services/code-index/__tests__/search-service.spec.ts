import "./mock-code-index-log"
import path from "node:path"
import { CodeIndexSearchService } from "../search-service"
import { codeIndexLog } from "../code-index-log"
import { FileFailureRegistry } from "../file-failure-registry"
import type { CodeIndexConfigManager } from "../config-manager"
import type { CodeIndexStateManager } from "../state-manager"
import type { IEmbedder, IVectorStore } from "../interfaces"
import type { IndexingState } from "../interfaces/manager"

describe("CodeIndexSearchService partial index", () => {
	function prepare(state: IndexingState = "Indexed", failed = true, exists = true) {
		const failures = new FileFailureRegistry()
		if (failed) {
			for (const file of ["src/a.ts", "other/b.ts"]) {
				failures.renew(file, "revision")
				failures.record(file, "revision", "embed", "unavailable", 3, "exhausted", "server")
			}
		}
		const config = {
			isFeatureEnabled: true,
			isFeatureConfigured: true,
			currentSearchMinScore: 0.4,
			currentSearchMaxResults: 12,
		}
		const stateManager = { getCurrentStatus: () => ({ systemStatus: state }), setSystemState: vi.fn() }
		const embedder = { createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[1, 0]] }) }
		const store = { search: vi.fn().mockResolvedValue([]), collectionExists: vi.fn().mockResolvedValue(exists) }
		const service = new CodeIndexSearchService(
			config as CodeIndexConfigManager,
			stateManager as unknown as CodeIndexStateManager,
			embedder as unknown as IEmbedder,
			store as unknown as IVectorStore,
			failures,
		)
		return { service, failures, store, embedder, config, stateManager }
	}

	it.each(["Indexed", "Indexing", "Standby"] as const)(
		"returns every failed path even with no matches in %s",
		async (state) => {
			const { service, store } = prepare(state)
			await expect(service.searchIndex("query", "src/folder")).resolves.toEqual({
				results: [],
				partial: true,
				failedFiles: ["src/a.ts", "other/b.ts"],
			})
			expect(store.search).toHaveBeenCalledWith([1, 0], path.normalize("src/folder"), 0.4, 12)
			expect(store.collectionExists).toHaveBeenCalledTimes(state === "Standby" ? 1 : 0)
		},
	)

	it.each(["Indexed", "Standby"] as const)(
		"returns available results marked partial with every failed path in %s",
		async (state) => {
			const { service, store } = prepare(state)
			const results = [{ id: "point", score: 0.9, payload: { filePath: "src/ok.ts" } }]
			store.search.mockResolvedValue(results)
			await expect(service.searchIndex("query")).resolves.toEqual({
				results,
				partial: true,
				failedFiles: ["src/a.ts", "other/b.ts"],
			})
		},
	)

	it("returns a complete envelope after recovery, including results", async () => {
		const { service, failures, store } = prepare()
		failures.clear("src/a.ts")
		failures.clear("other/b.ts")
		const results = [{ id: "point", score: 0.9 }]
		store.search.mockResolvedValue(results)
		await expect(service.searchIndex("query")).resolves.toEqual({ results, partial: false, failedFiles: [] })
	})

	it.each([
		["Standby", false, true],
		["Standby", true, false],
		["Error", true, true],
		["Stopping", true, true],
	] as const)("keeps readiness guard for %s / failures %s / collection %s", async (state, failed, exists) => {
		const { service, embedder } = prepare(state, failed, exists)
		await expect(service.searchIndex("query")).rejects.toThrow(`Current state: ${state}`)
		expect(embedder.createEmbeddings).not.toHaveBeenCalled()
	})

	it.each(["isFeatureEnabled", "isFeatureConfigured"] as const)("refuses when %s is false", async (setting) => {
		const { service, config } = prepare()
		config[setting] = false
		await expect(service.searchIndex("query")).rejects.toThrow("disabled or not configured")
	})

	it("snapshots failures at response time, including retrying entries", async () => {
		const { service, failures, store } = prepare("Indexed", false)
		store.search.mockImplementation(async () => {
			failures.renew("pending.ts", "new")
			failures.record("pending.ts", "new", "embed", "waiting", 1, "retrying", "server")
			return []
		})
		await expect(service.searchIndex("query")).resolves.toEqual({
			results: [],
			partial: true,
			failedFiles: ["pending.ts"],
		})
	})

	it.each([new Error("search unavailable"), "search unavailable"])(
		"keeps search errors handled (%s)",
		async (error) => {
			const { service, store, stateManager } = prepare()
			store.search.mockRejectedValue(error)
			await expect(service.searchIndex("query")).rejects.toBe(error)
			expect(codeIndexLog.error).toHaveBeenLastCalledWith("Search failed", { error })
			expect(stateManager.setSystemState).toHaveBeenCalledWith(
				"Error",
				"Search failed: search unavailable",
				"error",
			)
		},
	)
})
