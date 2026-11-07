import * as path from "path"

vi.mock("../../glob/discovery-options", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../glob/discovery-options")>()
	return {
		...actual,
		createDiscoveryContext: vi.fn(async (workspaceRoot: string) => ({
			workspaceRoot: path.resolve(workspaceRoot),
			options: { respectGitignore: true, followSymlinks: false },
			includedRoots: [],
			rooIgnore: { ignores: () => false },
		})),
	}
})
