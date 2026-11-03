import { safeWriteJson } from "../../utils/safeWriteJson"
import * as path from "path"
import * as fs from "fs/promises"

import type { ClineMessage } from "@roo-code/types"

import { fileExistsAtPath } from "../../utils/fs"

import { GlobalFileNames } from "../../shared/globalFileNames"
import { getTaskDirectoryPath } from "../../utils/storage"

export type ReadTaskMessagesOptions = {
	taskId: string
	globalStoragePath: string
}

export async function readTaskMessages({
	taskId,
	globalStoragePath,
}: ReadTaskMessagesOptions): Promise<ClineMessage[]> {
	const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
	const fileExists = await fileExistsAtPath(filePath)

	if (fileExists) {
		try {
			const parsedData = JSON.parse(await fs.readFile(filePath, "utf8"))
			if (!Array.isArray(parsedData)) {
				console.warn(
					`[readTaskMessages] Parsed data is not an array (got ${typeof parsedData}), returning empty. TaskId: ${taskId}, Path: ${filePath}`,
				)
				return []
			}
			return parsedData
		} catch (error) {
			console.warn(
				`[readTaskMessages] Failed to parse ${filePath} for task ${taskId}, returning empty: ${error instanceof Error ? error.message : String(error)}`,
			)
			return []
		}
	}

	return []
}

export type SaveTaskMessagesOptions = {
	messages: ClineMessage[]
	taskId: string
	globalStoragePath: string
}

const taskMessageSaveChains = new Map<string, Promise<void>>()

async function readMessageSnapshot(filePath: string): Promise<ClineMessage[]> {
	let content: string
	try {
		content = await fs.readFile(filePath, "utf8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return []
		}
		throw error
	}

	const snapshot = JSON.parse(content)
	if (!Array.isArray(snapshot)) {
		throw new TypeError(`Task message snapshot is not an array: ${filePath}`)
	}
	return snapshot
}

export async function saveTaskMessages({ messages, taskId, globalStoragePath }: SaveTaskMessagesOptions) {
	const previousSave = taskMessageSaveChains.get(taskId) ?? Promise.resolve()
	const save = previousSave.then(async () => {
		const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId)
		const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
		const snapshot = await readMessageSnapshot(filePath)
		const savedStamps = new Map<number, string>()
		for (const message of snapshot) {
			if (message.childTaskId !== undefined) {
				savedStamps.set(message.ts, message.childTaskId)
			}
		}
		const mergedMessages = messages.map((message) => {
			const childTaskId = savedStamps.get(message.ts)
			return message.childTaskId === undefined && childTaskId !== undefined
				? { ...message, childTaskId }
				: message
		})
		await safeWriteJson(filePath, mergedMessages)
	})

	// A failed save rejects its caller, not subsequent saves for this task.
	const settledSave = save.then(
		() => undefined,
		() => undefined,
	)
	taskMessageSaveChains.set(taskId, settledSave)
	void settledSave.then(() => {
		if (taskMessageSaveChains.get(taskId) === settledSave) {
			taskMessageSaveChains.delete(taskId)
		}
	})
	await save
}
