import * as path from "path"
import { ListFilesTool } from "../ListFilesTool"
import { listFiles } from "../../../services/glob/list-files"
import type { Task } from "../../task/Task"

vi.mock("../../../services/glob/list-files", () => ({ listFiles: vi.fn() }))
vi.mock("../../../utils/pathUtils", () => ({ isPathOutsideWorkspace: () => true }))
vi.mock("../../task/Task", () => ({ Task: class {} }))

describe("ListFilesTool discovery formatting", () => {
	it.each([false, true])(
		"shows blocked entries only with a lock when showIgnored=%s",
		async (showRooIgnoredFiles) => {
			vi.clearAllMocks()
			const workspace = path.resolve("workspace")
			const outside = path.resolve("outside")
			const blocked = path.join(outside, "secret.ts")
			const entries = [path.join(outside, "visible.ts"), ...(showRooIgnoredFiles ? [blocked] : [])]
			vi.mocked(listFiles).mockResolvedValue([entries, false, showRooIgnoredFiles ? [blocked] : []])
			const controller = { validateAccess: vi.fn(() => true) }
			const task = {
				cwd: workspace,
				consecutiveMistakeCount: 1,
				rooIgnoreController: controller,
				providerRef: { deref: () => ({ getState: async () => ({ showRooIgnoredFiles }) }) },
			}
			const callbacks = {
				askApproval: vi.fn().mockResolvedValue(true),
				handleError: vi.fn(),
				pushToolResult: vi.fn(),
			}
			await new ListFilesTool().execute({ path: outside, recursive: true }, task as unknown as Task, callbacks)
			expect(listFiles).toHaveBeenCalledWith(outside, true, 200, undefined, showRooIgnoredFiles)
			expect(controller.validateAccess).not.toHaveBeenCalled()
			expect(callbacks.handleError).not.toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				showRooIgnoredFiles ? "🔒 secret.ts\nvisible.ts" : "visible.ts",
			)
		},
	)
})
