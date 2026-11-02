import { build } from "esbuild"
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { Worker } from "node:worker_threads"
import { ParseWorkerClient } from "../parse-worker-client"
import { INDEX_STOP_LIMIT_MS, PARSE_TIMEOUT_MS } from "../constants"

const options = {
	content: "function example() { return 'a sufficiently long function body for indexing'; }",
	fileHash: "hash",
}

function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Did not settle within ${milliseconds} ms`)), milliseconds)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
}

async function probe(): Promise<number> {
	const started = performance.now()
	await new Promise((resolve) => setTimeout(resolve, 20))
	const elapsed = performance.now() - started
	expect(elapsed).toBeLessThan(500)
	return elapsed
}

describe("ParseWorkerClient real worker (T15)", () => {
	let directory: string
	const workers: Worker[] = []

	beforeAll(async () => {
		directory = await mkdtemp(path.join(tmpdir(), "roo-parse-worker-"))
		await build({
			entryPoints: [path.resolve("services/code-index/parse-worker.ts")],
			outfile: path.join(directory, "parse-worker.js"),
			bundle: true,
			platform: "node",
			format: "cjs",
		})
		await copyFile(path.resolve("services/code-index/fault-loop.wasm"), path.join(directory, "fault-loop.wasm"))
		await copyFile(
			path.resolve("node_modules/web-tree-sitter/tree-sitter.wasm"),
			path.join(directory, "tree-sitter.wasm"),
		)
		await copyFile(
			path.resolve("node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm"),
			path.join(directory, "tree-sitter-typescript.wasm"),
		)
	})

	afterEach(async () => {
		await Promise.all(workers.splice(0).map((worker) => worker.terminate()))
	})

	afterAll(async () => {
		if (directory) await rm(directory, { recursive: true, force: true })
	})

	function createWorker(fault?: string): Worker {
		const environment = { ...process.env }
		delete environment.ROO_PARSE_WORKER_FAULT
		if (fault) environment.ROO_PARSE_WORKER_FAULT = fault
		const worker = new Worker(path.join(directory, "parse-worker.js"), { env: environment, stdout: true })
		workers.push(worker)
		return worker
	}

	it("ships the exact unconditional WASM loop described by the source", async () => {
		const bytes = await readFile(path.join(directory, "fault-loop.wasm"))
		expect(bytes.toString("hex")).toBe(
			"0061736d0100000001040160000003020100070801046c6f6f7000000a0901070003400c000b0b",
		)
		expect(WebAssembly.validate(new Uint8Array(bytes))).toBe(true)
		const source = await readFile(path.resolve("services/code-index/fault-loop.wat"), "utf8")
		expect(source.trim().split(/\r?\n/)).toEqual([
			"(module",
			'  (func (export "loop")',
			"    (loop",
			"      br 0)))",
		])
	})

	it.each(["timeout", "stop"])(
		"physically exits a real WASM hang on %s without blocking the main loop",
		async (action) => {
			const worker = createWorker("wasm-hang")
			const entered = new Promise<void>((resolve, reject) => {
				worker.once("error", reject)
				worker.stdout!.on("data", (chunk: Buffer) => {
					if (chunk.toString().includes("parse worker entering wasm fault loop")) resolve()
				})
			})
			const client = new ParseWorkerClient(() => worker)
			let exitObserved = false
			worker.once("exit", () => {
				exitObserved = true
			})
			const pending = client.parseFile("hang.ts", options).catch((error) => error)
			await within(entered, 5000)
			const hangProbe = await probe()
			expect(exitObserved).toBe(false)
			let stoppingAt: number
			if (action === "stop") {
				stoppingAt = performance.now()
				expect(client.stop()).toBeUndefined()
			} else {
				expect(await within(pending, PARSE_TIMEOUT_MS)).toMatchObject({ category: "parse-timeout" })
				stoppingAt = performance.now()
			}
			const stoppingProbe = probe()
			await within(client.stopped, INDEX_STOP_LIMIT_MS)
			const exitElapsed = performance.now() - stoppingAt
			expect(exitElapsed).toBeLessThan(INDEX_STOP_LIMIT_MS)
			expect(exitObserved).toBe(true)
			expect(await pending).toMatchObject(
				action === "stop" ? { name: "AbortError" } : { category: "parse-timeout" },
			)
			console.log(
				`T15 ${action}: physical exit ${exitElapsed.toFixed(1)} ms; probes ${hangProbe.toFixed(1)}/${(await stoppingProbe).toFixed(1)} ms`,
			)
		},
	)

	it("injects a fatal abort and permits recovery with a new worker without the fault", async () => {
		const failed = new ParseWorkerClient(() => createWorker("abort"))
		await expect(failed.parseFile("abort.ts", options)).rejects.toMatchObject({
			name: "ParserFatalError",
			category: "parser-abort",
			message: expect.stringContaining("Aborted()"),
		})
		await within(failed.stopped, INDEX_STOP_LIMIT_MS)
		const replacement = new ParseWorkerClient(() => createWorker())
		try {
			const blocks = await within(replacement.parseFile("normal.ts", options), 5000)
			expect(blocks.length).toBeGreaterThan(0)
			expect(blocks[0].content).toContain("function example()")
		} finally {
			replacement.stop()
			await within(replacement.stopped, INDEX_STOP_LIMIT_MS)
		}
	})
})
