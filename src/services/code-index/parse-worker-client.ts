import { Worker } from "node:worker_threads"
import * as path from "node:path"
import { CodeParser } from "./processors/parser"
import type { CodeBlock, ICodeParser } from "./interfaces"
import { abortError, ParserFatalError, isParserAbort } from "./parser-errors"
import { PARSE_TIMEOUT_MS } from "./constants"

export interface ParseRequest {
	id: number
	filePath: string
	content: string
	fileHash: string
}

export interface ParseReply {
	id: number
	blocks?: CodeBlock[]
	fallback?: boolean
	error?: { message: string; fatal: boolean }
}

export interface ParseWorker {
	postMessage(request: ParseRequest): void
	on(event: "message", listener: (reply: ParseReply) => void): unknown
	on(event: "error", listener: (error: Error) => void): unknown
	on(event: "exit", listener: (code: number) => void): unknown
	terminate(): Promise<number>
}

interface PendingParse {
	request: ParseRequest
	resolve: (blocks: CodeBlock[]) => void
	reject: (error: Error) => void
	signal?: AbortSignal
	cancel: () => void
}

export class ParseWorkerClient implements ICodeParser {
	private worker?: ParseWorker
	private queue: PendingParse[] = []
	private active?: PendingParse
	private timer?: NodeJS.Timeout
	private nextId = 0
	private stopped = false
	private readonly parser: CodeParser
	private idleFailure?: Pick<ParserFatalError, "category" | "message">

	constructor(
		private readonly workerFactory: () => ParseWorker = () => new Worker(path.join(__dirname, "parse-worker.js")),
		private readonly timeoutMs = PARSE_TIMEOUT_MS,
	) {
		this.parser = new CodeParser((filePath, content, fileHash, signal) =>
			this.enqueue(filePath, content, fileHash, signal),
		)
	}

	parseFile(
		filePath: string,
		options?: { content?: string; fileHash?: string; signal?: AbortSignal },
	): Promise<CodeBlock[]> {
		const stopError = this.getStopError(filePath, options?.signal)
		if (stopError) return Promise.reject(stopError)
		return this.parser.parseFile(filePath, options)
	}

	private getStopError(filePath: string, signal?: AbortSignal): Error | undefined {
		if (signal?.aborted) return abortError()
		if (this.idleFailure) {
			const { category, message } = this.idleFailure
			this.idleFailure = undefined
			return new ParserFatalError(category, filePath, message)
		}
		if (this.stopped) return abortError()
		return undefined
	}

	private enqueue(filePath: string, content: string, fileHash: string, signal?: AbortSignal): Promise<CodeBlock[]> {
		const stopError = this.getStopError(filePath, signal)
		if (stopError) return Promise.reject(stopError)
		return new Promise((resolve, reject) => {
			const pending: PendingParse = {
				request: { id: ++this.nextId, filePath, content, fileHash },
				resolve,
				reject,
				signal,
				cancel: () => {
					if (this.active === pending) this.stop()
					else {
						this.queue = this.queue.filter((entry) => entry !== pending)
						this.settle(pending, abortError())
					}
				},
			}
			signal?.addEventListener("abort", pending.cancel, { once: true })
			this.queue.push(pending)
			this.dispatch()
		})
	}

	private settle(pending: PendingParse, error?: Error, blocks: CodeBlock[] = []): void {
		pending.signal?.removeEventListener("abort", pending.cancel)
		if (error) pending.reject(error)
		else pending.resolve(blocks)
	}

	private dispatch(): void {
		if (this.stopped || this.active || this.queue.length === 0) return
		this.active = this.queue.shift()!
		try {
			if (!this.worker) {
				this.worker = this.workerFactory()
				this.worker.on("message", (reply) => {
					if (this.stopped || reply.id !== this.active?.request.id) return
					if (reply.error?.fatal || (reply.error && isParserAbort(reply.error.message))) {
						this.fail("parser-abort", reply.error?.message)
						return
					}
					clearTimeout(this.timer)
					const completed = this.active
					this.active = undefined
					const blocks = !reply.fallback
						? reply.blocks
						: this.parser.fallbackContent(
								completed.request.filePath,
								completed.request.content,
								completed.request.fileHash,
							)
					this.settle(completed, reply.error ? new Error(reply.error.message) : undefined, blocks)
					this.dispatch()
				})
				this.worker.on("error", (error) => this.fail("parser-abort", error.message))
				this.worker.on("exit", (code) => this.fail("parser-abort", `Parse worker exited (${code})`))
			}
			this.timer = setTimeout(() => this.fail("parse-timeout"), this.timeoutMs)
			this.worker.postMessage(this.active.request)
		} catch (error) {
			this.fail("parser-abort", String(error))
		}
	}

	private fail(category: ParserFatalError["category"], message?: string): void {
		if (this.stopped) return
		const failed = this.active
		this.active = undefined
		if (failed) this.settle(failed, new ParserFatalError(category, failed.request.filePath, message))
		else this.idleFailure = { category, message: message ?? category }
		this.stop()
	}

	stop(): void {
		if (this.stopped) return
		this.stopped = true
		clearTimeout(this.timer)
		if (this.active) this.settle(this.active, abortError())
		this.active = undefined
		for (const pending of this.queue) this.settle(pending, abortError())
		this.queue = []
		void this.worker?.terminate().catch(() => undefined)
		this.worker = undefined
	}

	dispose(): void {
		this.stop()
	}
}
