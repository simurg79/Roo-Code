import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import type { ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

type VsCodeLmModels = NonNullable<ExtensionMessage["vsCodeLmModels"]>

const queryKey = ["vsCodeLmModels"]
const modelsFromMessage = (message: ExtensionMessage): VsCodeLmModels =>
	message.error !== undefined ? [] : (message.vsCodeLmModels ?? [])

const getVsCodeLmModels = (signal: AbortSignal) =>
	new Promise<VsCodeLmModels>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timeout)
			window.removeEventListener("message", handler)
			signal.removeEventListener("abort", abort)
		}
		const handler = (event: MessageEvent<ExtensionMessage>) => {
			if (event.data.type !== "vsCodeLmModels") {
				return
			}
			cleanup()
			resolve(modelsFromMessage(event.data))
		}
		const abort = () => {
			cleanup()
			reject(new Error("VS Code LM models request cancelled"))
		}
		const timeout = setTimeout(() => {
			cleanup()
			resolve([])
		}, 10000)

		window.addEventListener("message", handler)
		signal.addEventListener("abort", abort)
		vscode.postMessage({ type: "requestVsCodeLmModels" })
	})

export const useVsCodeLmModels = (enabled: boolean) => {
	const queryClient = useQueryClient()

	useEffect(() => {
		if (!enabled) {
			return
		}
		const handler = (event: MessageEvent<ExtensionMessage>) => {
			if (event.data.type === "vsCodeLmModels") {
				queryClient.setQueryData(queryKey, modelsFromMessage(event.data))
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [enabled, queryClient])

	return useQuery({
		queryKey,
		queryFn: ({ signal }) => getVsCodeLmModels(signal),
		enabled,
	})
}
