import { parentPort } from "node:worker_threads"
import { CodeParser } from "./processors/parser"
import { isParserAbort } from "./parser-errors"
import type { ParseRequest, ParseReply } from "./parse-worker-client"

const parser = new CodeParser(undefined, __dirname)
parentPort!.on("message", async (request: ParseRequest) => {
	let reply: ParseReply
	try {
		const blocks = await parser.parseFile(request.filePath, {
			content: request.content,
			fileHash: request.fileHash,
		})
		reply = { id: request.id, blocks, fallback: parser.fallbackNeeded }
	} catch (error) {
		reply = {
			id: request.id,
			error: { message: error instanceof Error ? error.message : String(error), fatal: isParserAbort(error) },
		}
	}
	parentPort!.postMessage(reply)
})
