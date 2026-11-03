import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { performance } from "perf_hooks"

import type { ClineMessage } from "@roo-code/types"

import * as writer from "../../../utils/safeWriteJson"
import { saveTaskMessages } from "../taskMessages"

const benchmark = process.env.SUBTASK_LINKS_BENCHMARK === "1" ? it : it.skip

benchmark(
	"measures real long-conversation saves and safeWriteJson on temporary disk",
	async () => {
		const globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "roo-subtask-links-benchmark-"))
		const taskId = "long-conversation"
		const filePath = path.join(globalStoragePath, "tasks", taskId, "ui_messages.json")
		const messages: ClineMessage[] = Array.from({ length: 2000 }, (_, index) => ({
			ts: 1700000000000 + index,
			type: index % 4 === 0 ? "ask" : "say",
			...(index % 4 === 0 ? { ask: "tool" as const } : { say: "text" as const }),
			text: `${index}: ${"Representative conversation, code snippets and tool output. ".repeat(36)}`,
			...(index % 20 === 0 ? { childTaskId: `child-${index}` } : {}),
		}))
		const realWriter = writer.safeWriteJson
		const writerCosts: number[] = []
		const writerSpy = vi.spyOn(writer, "safeWriteJson").mockImplementation(async (...arguments_) => {
			const started = performance.now()
			await realWriter(...arguments_)
			writerCosts.push(performance.now() - started)
		})
		const saveCosts: number[] = []
		const directCosts: number[] = []
		const samples = 30
		const warmups = 5
		try {
			for (let iteration = 0; iteration < warmups + samples; iteration++) {
				const directStarted = performance.now()
				await realWriter(filePath, messages)
				const directCost = performance.now() - directStarted
				const saveStarted = performance.now()
				await saveTaskMessages({ globalStoragePath, taskId, messages })
				const saveCost = performance.now() - saveStarted
				if (iteration >= warmups) {
					directCosts.push(directCost)
					saveCosts.push(saveCost)
				}
			}
			const summary = (costs: number[]) => {
				const sorted = [...costs].sort((left, right) => left - right)
				return {
					meanMs: costs.reduce((total, cost) => total + cost, 0) / costs.length,
					medianMs: sorted[Math.floor(sorted.length / 2)],
					minimumMs: sorted[0],
					maximumMs: sorted.at(-1),
				}
			}
			expect(JSON.parse(await fs.readFile(filePath, "utf8"))).toEqual(messages)
			expect(writerCosts).toHaveLength(warmups + samples)
			console.log(
				JSON.stringify(
					{
						node: process.version,
						platform: process.platform,
						rows: messages.length,
						bytes: Buffer.byteLength(JSON.stringify(messages)),
						warmups,
						samples,
						saveTaskMessages: summary(saveCosts),
						safeWriteJsonWithinSave: summary(writerCosts.slice(warmups)),
						directSafeWriteJson: summary(directCosts),
						saveSamplesMs: saveCosts,
						writerSamplesMs: writerCosts.slice(warmups),
						directSamplesMs: directCosts,
					},
					null,
					2,
				),
			)
		} finally {
			writerSpy.mockRestore()
			await fs.rm(globalStoragePath, { recursive: true, force: true })
		}
	},
	120_000,
)
