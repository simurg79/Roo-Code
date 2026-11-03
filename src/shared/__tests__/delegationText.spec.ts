import { performance } from "perf_hooks"
import { delegationText } from "../delegationText"

it("keeps normalization behavior identical to the extracted NewTaskTool expression", () => {
	const corpus = [
		"",
		"ordinary request",
		"a\\b @c",
		...Array.from({ length: 12 }, (_, count) => `see ${"\\".repeat(count)}@file`),
	]
	for (const text of corpus) {
		expect(delegationText(text)).toBe(text.replace(/\\\\@/g, "\\@"))
	}
})

it("normalization scales linearly across a 1x/2x/4x/8x ladder", () => {
	const unit = "ordinary words see \\\\@file and a\\b @c ".repeat(2048)
	const inputs = [1, 2, 4, 8].map((factor) => unit.repeat(factor))
	for (const input of inputs) delegationText(input)
	const timings = inputs.map((input) => {
		const samples = Array.from({ length: 7 }, () => {
			const started = performance.now()
			for (let iteration = 0; iteration < 30; iteration++) delegationText(input)
			return (performance.now() - started) / 30
		}).sort((first, second) => first - second)
		return samples[3]
	})
	console.log(
		"delegationText ladder",
		JSON.stringify(
			inputs.map((input, index) => ({
				factor: 2 ** index,
				characters: input.length,
				milliseconds: timings[index],
				ratio: timings[index] / timings[0],
			})),
		),
	)
	expect(timings[2] / timings[0]).toBeLessThan(10)
	expect(timings[3] / timings[0]).toBeLessThan(20)
})
