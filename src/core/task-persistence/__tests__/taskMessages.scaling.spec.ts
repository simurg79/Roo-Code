import { performance } from "perf_hooks"

import type { ClineMessage } from "@roo-code/types"

const mocks = vi.hoisted(() => ({
	readFile: vi.fn(),
	write: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("fs/promises", () => ({ readFile: mocks.readFile }))
vi.mock("../../../utils/safeWriteJson", () => ({ safeWriteJson: mocks.write }))
vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: async () => "/temporary/tasks/scaling",
}))

import { saveTaskMessages } from "../taskMessages"

function message(ts: number, childTaskId?: string): ClineMessage {
	return { ts, type: "say", say: "subtask_result", text: `result-${ts}`, childTaskId }
}

it("matches the direct D4 reference merge across representative snapshots", async () => {
	const corpora = [
		{ snapshot: [], incoming: [message(1)] },
		{ snapshot: [message(1, "saved")], incoming: [message(1)] },
		{ snapshot: [message(1, "saved")], incoming: [message(1, "replacement")] },
		{ snapshot: [message(1, "saved"), message(2, "deleted")], incoming: [] },
		{
			snapshot: [message(1, "first"), message(2, "second"), message(3)],
			incoming: [message(2), { ...message(1), text: "edited" }, message(4)],
		},
	]
	for (const { snapshot, incoming } of corpora) {
		mocks.readFile.mockResolvedValue(JSON.stringify(snapshot))
		await saveTaskMessages({ messages: incoming, taskId: "equivalence", globalStoragePath: "/temporary" })
		const expected = incoming.map((row) => {
			const saved = snapshot.find((savedRow) => savedRow.ts === row.ts)
			return row.childTaskId === undefined && saved?.childTaskId !== undefined
				? { ...row, childTaskId: saved.childTaskId }
				: row
		})
		expect(mocks.write.mock.lastCall?.[1]).toEqual(expected)
		mocks.write.mockClear()
	}
})

it("saved child-identity visits scale with row counts at 1x/2x/4x/8x", async () => {
	const parseSpy = vi.spyOn(JSON, "parse")
	const measurements: { multiplier: number; rows: number; medianMs: number; visits: number }[] = []
	try {
		for (const multiplier of [1, 2, 4, 8]) {
			const rowCount = 20000 * multiplier
			let visits = 0
			const snapshot = Array.from({ length: rowCount }, (_, index) => ({
				...message(index),
				get childTaskId() {
					visits++
					return `child-${index}`
				},
			}))
			const incoming = Array.from({ length: rowCount }, (_, index) => message(index))
			mocks.readFile.mockResolvedValue("snapshot")
			parseSpy.mockReturnValue(snapshot)
			const save = () =>
				saveTaskMessages({ messages: incoming, taskId: "scaling", globalStoragePath: "/temporary" })
			for (let warmup = 0; warmup < 5; warmup++) {
				await save()
				mocks.write.mockClear()
			}
			visits = 0
			await save()
			expect(visits).toBe(rowCount * 2)
			const scanVisits = visits
			const costs: number[] = []
			for (let sample = 0; sample < 9; sample++) {
				const started = performance.now()
				for (let repetition = 0; repetition < 5; repetition++) {
					await save()
					mocks.write.mockClear()
				}
				costs.push((performance.now() - started) / 5)
			}
			costs.sort((left, right) => left - right)
			measurements.push({ multiplier, rows: rowCount, medianMs: costs[4], visits: scanVisits })
		}
		const ratio = measurements[2].medianMs / measurements[0].medianMs
		console.log(JSON.stringify({ measurements, ratio4x: ratio }, null, 2))
		expect(measurements[2].visits / measurements[0].visits).toBe(4)
		for (const measurement of measurements.slice(1)) {
			expect(measurement.visits / measurements[0].visits).toBe(measurement.multiplier)
		}
	} finally {
		parseSpy.mockRestore()
	}
}, 120_000)
