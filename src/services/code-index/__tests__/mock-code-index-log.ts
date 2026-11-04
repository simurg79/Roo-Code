vi.mock("../code-index-log", () => ({
	codeIndexLog: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		configure: vi.fn(),
		dispose: vi.fn(),
		createFailureBatch: vi.fn(() => ({ record: vi.fn(), flush: vi.fn() })),
	},
}))
