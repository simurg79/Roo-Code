import { useState } from "react"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
} from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"

export const SessionCompletionButton = ({ taskId, completed }: { taskId: string; completed: boolean }) => {
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(false)

	return (
		<div onClick={(event) => event.stopPropagation()}>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => {
					if (completed) {
						vscode.postMessage({ type: "reopenSession", text: taskId })
					} else {
						setOpen(true)
					}
				}}>
				{t(completed ? "history:reopenSession" : "history:markSessionCompleted")}
			</Button>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("history:markSessionCompleted")}</AlertDialogTitle>
						<AlertDialogDescription>{t("history:completeSessionMessage")}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel asChild>
							<Button variant="secondary">{t("history:cancel")}</Button>
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button onClick={() => vscode.postMessage({ type: "markSessionCompleted", text: taskId })}>
								{t("history:confirmSessionCompleted")}
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
