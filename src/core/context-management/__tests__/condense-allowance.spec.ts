import { getCondenseAllowance, willManageContext } from "../index"
import { condenseAllowanceCases } from "./condense-allowance-cases"

describe("getCondenseAllowance", () => {
	it.each(condenseAllowanceCases)("II-07 agrees with real predicates: $name", ({ options }) => {
		const originalOptions = structuredClone(options)
		const allowance = getCondenseAllowance(options)
		expect(Number.isInteger(allowance)).toBe(true)
		for (const lastMessageTokens of [0, 7]) {
			expect(
				willManageContext({ ...options, totalTokens: allowance - lastMessageTokens, lastMessageTokens }),
			).toBe(false)
			expect(
				willManageContext({ ...options, totalTokens: allowance + 1 - lastMessageTokens, lastMessageTokens }),
			).toBe(true)
		}
		expect(options).toEqual(originalOptions)
	})

	it("II-08 corrects the 16.1% floating-point boundary", () => {
		const options = condenseAllowanceCases.find(({ name }) => name === "floating point boundary II-08")!.options
		expect(getCondenseAllowance(options)).toBe(20607)
		expect(willManageContext({ ...options, totalTokens: 20607, lastMessageTokens: 0 })).toBe(false)
		expect(willManageContext({ ...options, totalTokens: 20608, lastMessageTokens: 0 })).toBe(true)
	})

	it.each([8192, 9000])("II-12 rejects all when reservation %s exhausts the denominator", (maxTokens) => {
		const options = {
			...condenseAllowanceCases[0].options,
			contextWindow: 8192,
			maxTokens,
			useAvailableInputForContextPercent: true,
		}
		expect(getCondenseAllowance(options)).toBe(-1)
		for (const totalTokens of [0, 1, 8192]) {
			expect(willManageContext({ ...options, totalTokens, lastMessageTokens: 0 })).toBe(true)
		}
		expect(getCondenseAllowance({ ...options, autoCondenseContext: false })).toBe(
			Math.floor(8192 * 0.9 - maxTokens),
		)
	})
})
