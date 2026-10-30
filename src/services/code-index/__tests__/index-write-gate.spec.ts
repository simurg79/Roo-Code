import { IndexWriteGate } from "../index-write-gate"

function deferred() {
	let resolve!: () => void
	let reject!: (error: Error) => void
	const promise = new Promise<void>((complete, fail) => {
		resolve = complete
		reject = fail
	})
	return { promise, resolve, reject }
}

describe("IndexWriteGate", () => {
	it("refuses late embedding writes and all subsequent mutations after abort", async () => {
		const gate = new IndexWriteGate()
		const attempt = new AbortController()
		attempt.abort()
		const write = vi.fn()
		await expect(gate.run(attempt.signal, write, ["file.ts"])).rejects.toMatchObject({ name: "AbortError" })
		expect(write).not.toHaveBeenCalled()
	})

	it.each(["resolve", "reject"] as const)(
		"orders a retry behind an issued old write that will %s",
		async (outcome) => {
			const gate = new IndexWriteGate()
			const oldAttempt = new AbortController()
			const nextAttempt = new AbortController()
			const held = deferred()
			const oldWrite = vi.fn(() => held.promise)
			const pending = gate.run(oldAttempt.signal, oldWrite, ["file.ts"]).catch((error) => error)
			await vi.waitFor(() => expect(oldWrite).toHaveBeenCalled())
			oldAttempt.abort()
			const newWrite = vi.fn()
			const retry = gate.run(nextAttempt.signal, newWrite)
			await Promise.resolve()
			expect(newWrite).not.toHaveBeenCalled()
			if (outcome === "resolve") held.resolve()
			else held.reject(new Error("request timeout"))
			await pending
			await retry
			expect(newWrite).toHaveBeenCalledOnce()
			expect(gate.needsReconciliation("file.ts")).toBe(outcome === "reject")
			gate.reconciled("file.ts")
			expect(gate.needsReconciliation("file.ts")).toBe(false)
		},
	)
})
