import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"

import type { ExtensionMessage } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"

import { useVsCodeLmModels } from "../useVsCodeLmModels"
import { useSelectedModel } from "../useSelectedModel"

// Share the renderer's external React instance rather than Vite's separate module graph.
vi.mock("react", async () => {
	const { createRequire } = await import("node:module")
	const react = createRequire(import.meta.url)("react")
	return { ...react, default: react }
})
vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))
vi.mock("../useRouterModels", () => ({
	useRouterModels: () => ({ data: {}, isLoading: false, isError: false }),
}))
vi.mock("../useOpenRouterModelProviders", () => ({
	useOpenRouterModelProviders: () => ({ data: {}, isLoading: false, isError: false }),
}))
vi.mock("../useLmStudioModels", () => ({
	useLmStudioModels: () => ({ data: {}, isLoading: false, isError: false }),
}))
vi.mock("../useOllamaModels", () => ({
	useOllamaModels: () => ({ data: {}, isLoading: false, isError: false }),
}))

const models: NonNullable<ExtensionMessage["vsCodeLmModels"]> = [
	{
		id: "live-image-model",
		vendor: "new-vendor",
		family: "unlisted-family",
		version: "1",
		name: "Live image model",
		maxInputTokens: 43210,
		supportsImages: true,
	},
]

const reply = (message: ExtensionMessage) =>
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: message }))
	})

const createHarness = () => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)
	return { queryClient, wrapper }
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	vi.useRealTimers()
})

describe("useVsCodeLmModels", () => {
	it("requests generic discovery with the existing string message and caches optional metadata", async () => {
		const { queryClient, wrapper } = createHarness()
		const { result } = renderHook(() => useVsCodeLmModels(true), { wrapper })
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "requestVsCodeLmModels" })
		reply({ type: "vsCodeLmModels", vsCodeLmModels: models })

		await waitFor(() => expect(result.current.data).toEqual(models))
		expect(queryClient.getQueryData(["vsCodeLmModels"])).toEqual(models)
		expect(result.current.isSuccess).toBe(true)
	})

	it("does not request discovery when disabled and requests it when enabled", async () => {
		const { wrapper } = createHarness()
		const { result, rerender } = renderHook(({ enabled }) => useVsCodeLmModels(enabled), {
			initialProps: { enabled: false },
			wrapper,
		})
		expect(vscode.postMessage).not.toHaveBeenCalled()
		reply({ type: "vsCodeLmModels", vsCodeLmModels: models })
		expect(result.current.data).toBeUndefined()
		rerender({ enabled: true })
		expect(vscode.postMessage).toHaveBeenCalledTimes(1)
		reply({ type: "vsCodeLmModels", vsCodeLmModels: models })
		await waitFor(() => expect(result.current.data).toEqual(models))
	})

	it("shares one request and cache across consumers", async () => {
		const { wrapper } = createHarness()
		const { result } = renderHook(() => [useVsCodeLmModels(true), useVsCodeLmModels(true)], { wrapper })
		expect(vscode.postMessage).toHaveBeenCalledTimes(1)
		reply({ type: "vsCodeLmModels", vsCodeLmModels: models })
		await waitFor(() => {
			expect(result.current[0].data).toEqual(models)
			expect(result.current[1].data).toEqual(models)
		})
	})

	it.each([
		{ type: "vsCodeLmModels", vsCodeLmModels: [] },
		{ type: "vsCodeLmModels", error: "Discovery failed" },
		{ type: "vsCodeLmModels", error: "Discovery failed", vsCodeLmModels: models },
		{ type: "vsCodeLmModels" },
	] satisfies ExtensionMessage[])("clears stale cache on a discovery reply: %j", async (message) => {
		const { queryClient, wrapper } = createHarness()
		const { result } = renderHook(() => useVsCodeLmModels(true), { wrapper })
		reply({ type: "vsCodeLmModels", vsCodeLmModels: models })
		await waitFor(() => expect(result.current.data).toEqual(models))

		reply(message)
		await waitFor(() => expect(result.current.data).toEqual([]))
		expect(queryClient.getQueryData(["vsCodeLmModels"])).toEqual([])
	})

	it("clears stale cache when a refetch receives an explicit discovery error", async () => {
		const { queryClient, wrapper } = createHarness()
		const { result } = renderHook(() => useVsCodeLmModels(true), { wrapper })
		reply({ type: "vsCodeLmModels", vsCodeLmModels: models })
		await waitFor(() => expect(result.current.data).toEqual(models))

		let refetch: ReturnType<typeof result.current.refetch>
		act(() => {
			refetch = result.current.refetch()
		})
		expect(vscode.postMessage).toHaveBeenCalledTimes(2)
		reply({ type: "vsCodeLmModels", error: "Discovery failed" })
		await act(async () => {
			await refetch
		})
		await waitFor(() => expect(result.current.data).toEqual([]))
		expect(queryClient.getQueryData(["vsCodeLmModels"])).toEqual([])
	})

	it.each(["routerModels", "vsCodeLmApiAvailable", "state"] as const)(
		"ignores unrelated %s replies while fetching and after caching",
		async (type) => {
			const { queryClient, wrapper } = createHarness()
			const { result } = renderHook(() => useVsCodeLmModels(true), { wrapper })
			reply({ type, error: "Unrelated error", vsCodeLmModels: [] })
			expect(queryClient.getQueryData(["vsCodeLmModels"])).toBeUndefined()
			expect(result.current.isFetching).toBe(true)
			reply({ type: "vsCodeLmModels", vsCodeLmModels: models })
			await waitFor(() => expect(result.current.data).toEqual(models))
			reply({ type, error: "Unrelated error", vsCodeLmModels: [] })
			expect(queryClient.getQueryData(["vsCodeLmModels"])).toEqual(models)
		},
	)

	it("clears stale cache when discovery times out", async () => {
		vi.useFakeTimers()
		const { queryClient, wrapper } = createHarness()
		queryClient.setQueryData(["vsCodeLmModels"], models)
		renderHook(() => useVsCodeLmModels(true), { wrapper })
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10000)
		})
		expect(queryClient.getQueryData(["vsCodeLmModels"])).toEqual([])
	})

	it("removes listeners on unmount so later discovery cannot update an inactive cache", async () => {
		const { queryClient, wrapper } = createHarness()
		const { unmount } = renderHook(() => useVsCodeLmModels(true), { wrapper })
		unmount()
		reply({ type: "vsCodeLmModels", vsCodeLmModels: models })
		expect(queryClient.getQueryData(["vsCodeLmModels"])).toBeUndefined()
	})

	it("updates selected image capability from discovery and clears it on error without losing budgets", async () => {
		const { wrapper } = createHarness()
		const { result } = renderHook(
			() => useSelectedModel({ apiProvider: "vscode-lm", vsCodeLmModelSelector: { id: models[0].id } }),
			{ wrapper },
		)
		const contextWindow = result.current.info?.contextWindow
		expect(contextWindow).toBeGreaterThan(0)
		expect(result.current.info?.supportsImages).toBeUndefined()
		reply({ type: "vsCodeLmModels", vsCodeLmModels: models })
		await waitFor(() => expect(result.current.info?.supportsImages).toBe(true))
		reply({ type: "vsCodeLmModels", error: "Discovery failed" })
		await waitFor(() => expect(result.current.info?.supportsImages).toBeUndefined())
		expect(result.current.info?.contextWindow).toBe(contextWindow)
	})

	it("does not request generic discovery for another selected provider", () => {
		const { wrapper } = createHarness()
		renderHook(() => useSelectedModel({ apiProvider: "anthropic" }), { wrapper })
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})
})
