import { ClineProvider } from "../core/webview/ClineProvider"

describe("ClineProvider.removeClineFromStack", () => {
	it.each([undefined, "parent-1"])("SH-07: never repairs metadata (parent %s)", async (parentTaskId) => {
		const cleanup = vi.fn()
		const task = { taskId: "child", parentTaskId, emit: vi.fn(), abortTask: vi.fn() }
		const provider = {
			clineStack: [task],
			taskEventListeners: new Map([[task, [cleanup]]]),
			getTaskWithId: vi.fn(),
			updateTaskHistory: vi.fn(),
			log: vi.fn(),
		}
		await ClineProvider.prototype.removeClineFromStack.call(provider as any)
		expect(provider.clineStack).toEqual([])
		expect(task.abortTask).toHaveBeenCalledWith(true)
		expect(cleanup).toHaveBeenCalledOnce()
		expect(provider.getTaskWithId).not.toHaveBeenCalled()
		expect(provider.updateTaskHistory).not.toHaveBeenCalled()
	})

	it("still cleans up when abort fails", async () => {
		const task = { taskId: "child", emit: vi.fn(), abortTask: vi.fn().mockRejectedValue(new Error("abort")) }
		const provider = { clineStack: [task], taskEventListeners: new Map(), log: vi.fn() }
		await ClineProvider.prototype.removeClineFromStack.call(provider as any)
		expect(provider.clineStack).toEqual([])
		expect(provider.log).toHaveBeenCalledOnce()
	})

	it("handles an empty stack", async () => {
		await ClineProvider.prototype.removeClineFromStack.call({ clineStack: [] } as any)
	})
})
