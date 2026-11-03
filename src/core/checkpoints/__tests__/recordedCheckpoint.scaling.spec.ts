import { performance } from "perf_hooks"
import type { Task } from "../../task/Task"
import { assertRecordedCheckpoint } from "../recordedCheckpoint"

vi.mock("../../../i18n", () => ({ t: (key: string) => key }))

function createTask(messageCount: number, onVisit: () => void) {
	const commitHash = "a".repeat(40)
	const clineMessages = Array.from({ length: messageCount }, (_value, index) => ({
		get say() {
			onVisit()
			return "checkpoint_saved"
		},
		text: index === messageCount - 1 ? commitHash : "b".repeat(40),
	})) as Task["clineMessages"]
	return { task: { taskId: "scaling", clineMessages }, commitHash }
}

describe("recorded checkpoint scanning cost", () => {
	it("uses one visit per message and a linear 1x/2x/4x/8x benchmark ladder", () => {
		const measurements = []
		for (const multiplier of [1, 2, 4, 8]) {
			let visits = 0
			const { task, commitHash } = createTask(2000 * multiplier, () => {
				visits++
			})
			assertRecordedCheckpoint(task, commitHash)
			expect(visits).toBe(2000 * multiplier)
			const started = performance.now()
			for (let iteration = 0; iteration < 200; iteration++) assertRecordedCheckpoint(task, commitHash)
			measurements.push({ multiplier, visits, durationMs: performance.now() - started })
		}
		expect(measurements[2].visits / measurements[0].visits).toBe(4)
		expect(measurements[2].durationMs / measurements[0].durationMs).toBeLessThan(12)
		console.log("Recorded checkpoint benchmark ladder", measurements)
	})
})
