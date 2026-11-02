import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		include: ["services/code-index/vector-store/__tests__/*.integration.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
})
