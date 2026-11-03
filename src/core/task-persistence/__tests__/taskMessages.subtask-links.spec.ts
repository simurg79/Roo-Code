import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { ClineMessage } from "@roo-code/types"

import * as writer from "../../../utils/safeWriteJson"
import { readTaskMessages, saveTaskMessages } from "../taskMessages"

vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	return { ...actual, readFile: vi.fn(actual.readFile) }
})

let globalStoragePath: string
const taskId = "parent"
const request: ClineMessage = { ts: 1, type: "ask", ask: "tool", text: "delegate" }
const result: ClineMessage = { ts: 2, type: "say", say: "subtask_result", text: "done" }
const rows = [request, result]
const stampedRows = rows.map((message) => ({ ...message, childTaskId: `child-${message.ts}` }))
const filePath = () => path.join(globalStoragePath, "tasks", taskId, "ui_messages.json")
const save = (messages: ClineMessage[], destination = taskId) =>
	saveTaskMessages({ globalStoragePath, taskId: destination, messages })
const read = () => readTaskMessages({ globalStoragePath, taskId })

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

function blockWrites(count: number) {
	const realWriter = writer.safeWriteJson
	const gates = Array.from({ length: count }, () => ({ entered: deferred(), release: deferred() }))
	let writeCount = 0
	const spy = vi.spyOn(writer, "safeWriteJson").mockImplementation(async (...arguments_) => {
		const gate = gates[writeCount++]
		if (gate) {
			gate.entered.resolve()
			await gate.release.promise
		}
		await realWriter(...arguments_)
	})
	return { gates, spy }
}

beforeEach(async () => {
	globalStoragePath = await fs.mkdtemp(path.join(os.tmpdir(), "roo-subtask-links-"))
})

afterEach(async () => {
	vi.restoreAllMocks()
	await fs.rm(globalStoragePath, { recursive: true, force: true })
})

it("SL-01 preserves request and result stamps from detached pre-stamp snapshots without mutating input", async () => {
	await save(stampedRows)
	await save(rows)
	expect(await read()).toEqual(stampedRows)
	expect(rows).toEqual([request, result])
	expect(rows.every((message) => message.childTaskId === undefined)).toBe(true)
})

it("SL-02 preserves file-only stamps after fresh module reload", async () => {
	await save(stampedRows)
	vi.resetModules()
	const reloaded = await import("../taskMessages")
	await reloaded.saveTaskMessages({ globalStoragePath, taskId, messages: rows })
	expect(await read()).toEqual(stampedRows)
})

it("SL-03 merges stamps by ts only, keeping incoming order and fields, not file-only rows", async () => {
	await save([...stampedRows, { ts: 3, type: "say", say: "text", text: "file only" }])
	const incoming: ClineMessage[] = [
		{ ...result, text: "updated", partial: true },
		{ ...request, text: "changed" },
	]
	await save(incoming)
	expect(await read()).toEqual(incoming.map((message) => ({ ...message, childTaskId: `child-${message.ts}` })))
})

it("SL-04 omitted stamped rows remain deleted, including an empty incoming snapshot", async () => {
	await save(stampedRows)
	await save([request])
	expect(await read()).toEqual([stampedRows[0]])
	await save([])
	expect(await read()).toEqual([])
	await save([result])
	expect(await read()).toEqual([result])
})

it("SL-05 explicit replacement stamps become durable authority for later identity-free saves", async () => {
	await save(stampedRows)
	const replacements = rows.map((message) => ({ ...message, childTaskId: "replacement" }))
	await save(replacements)
	await save(rows.map((message) => ({ ...message, childTaskId: undefined })))
	expect(await read()).toEqual(replacements)
})

it("SL-06 serializes simultaneous pre-stamp and stamped writes", async () => {
	const { gates, spy } = blockWrites(1)
	const staleSave = save(rows)
	await gates[0].entered.promise
	const stampSave = save(stampedRows)
	await save([], "other-task")
	expect(spy).toHaveBeenCalledTimes(2)
	gates[0].release.resolve()
	await Promise.all([staleSave, stampSave])
	expect(await read()).toEqual(stampedRows)
})

it("SL-06 a stale save queued after a blocked stamp reads that stamp only after its write", async () => {
	const { gates } = blockWrites(1)
	const stampSave = save(stampedRows)
	await gates[0].entered.promise
	const staleSave = save(rows)
	gates[0].release.resolve()
	await Promise.all([stampSave, staleSave])
	expect(await read()).toEqual(stampedRows)
})

it("SL-07 writes incoming rows when the snapshot is absent (ENOENT)", async () => {
	await expect(fs.readFile(filePath())).rejects.toMatchObject({ code: "ENOENT" })
	await save(rows)
	expect(await read()).toEqual(rows)
})

it.each(["{not JSON", '{"not":"an array"}', "null"])(
	"SL-08 rejects invalid snapshot %s without invoking the writer or changing bytes",
	async (content) => {
		await save(stampedRows)
		await fs.writeFile(filePath(), content)
		const writeSpy = vi.spyOn(writer, "safeWriteJson")
		await expect(save(rows)).rejects.toBeInstanceOf(Error)
		expect(writeSpy).not.toHaveBeenCalled()
		expect(await fs.readFile(filePath(), "utf8")).toBe(content)
	},
)

it("SL-08 non-ENOENT read failures reject with the original error and write nothing", async () => {
	await save(stampedRows)
	const originalBytes = await fs.readFile(filePath(), "utf8")
	const error = Object.assign(new Error("access denied"), { code: "EACCES" })
	const readSpy = vi.spyOn(fs, "readFile").mockRejectedValueOnce(error)
	const writeSpy = vi.spyOn(writer, "safeWriteJson")
	await expect(save(rows)).rejects.toBe(error)
	expect(writeSpy).not.toHaveBeenCalled()
	readSpy.mockRestore()
	expect(await fs.readFile(filePath(), "utf8")).toBe(originalBytes)
})

it("SL-08 a real directory read error does not invoke the writer or alter saved bytes", async () => {
	await save(stampedRows)
	const originalBytes = await fs.readFile(filePath(), "utf8")
	const retainedPath = `${filePath()}.retained`
	await fs.rename(filePath(), retainedPath)
	await fs.mkdir(filePath())
	const writeSpy = vi.spyOn(writer, "safeWriteJson")
	await expect(save(rows)).rejects.toMatchObject({ code: "EISDIR" })
	expect(writeSpy).not.toHaveBeenCalled()
	expect((await fs.stat(filePath())).isDirectory()).toBe(true)
	expect(await fs.readFile(retainedPath, "utf8")).toBe(originalBytes)
})

it("SL-09 read rejection does not poison an already queued save", async () => {
	await save(stampedRows)
	const entered = deferred()
	const release = deferred()
	const error = Object.assign(new Error("read failure"), { code: "EIO" })
	vi.spyOn(fs, "readFile").mockImplementationOnce(async () => {
		entered.resolve()
		await release.promise
		throw error
	})
	const failingSave = save(rows)
	const rejected = expect(failingSave).rejects.toBe(error)
	await entered.promise
	const laterSave = save(rows)
	release.resolve()
	await rejected
	await laterSave
	expect(await read()).toEqual(stampedRows)
})

it("SL-09 write rejection does not poison an already queued save", async () => {
	await save(stampedRows)
	const entered = deferred()
	const release = deferred()
	const error = new Error("write failure")
	vi.spyOn(writer, "safeWriteJson").mockImplementationOnce(async () => {
		entered.resolve()
		await release.promise
		throw error
	})
	const failingSave = save(rows)
	const rejected = expect(failingSave).rejects.toBe(error)
	await entered.promise
	const laterSave = save(rows)
	release.resolve()
	await rejected
	await laterSave
	expect(await read()).toEqual(stampedRows)
})

it("SL-10 earlier cleanup cannot remove a newer blocked chain entry", async () => {
	const { gates, spy } = blockWrites(2)
	const firstSave = save(rows)
	await gates[0].entered.promise
	const secondSave = save(stampedRows)
	gates[0].release.resolve()
	await firstSave
	await gates[1].entered.promise
	const thirdSave = save(rows)
	await save([], "independent-task")
	expect(spy).toHaveBeenCalledTimes(3)
	gates[1].release.resolve()
	await Promise.all([secondSave, thirdSave])
	expect(await read()).toEqual(stampedRows)
})

it("settled task chains hold no stamps after the saved file is removed", async () => {
	await save(stampedRows)
	await fs.unlink(filePath())
	await save(rows)
	expect(await read()).toEqual(rows)
})
