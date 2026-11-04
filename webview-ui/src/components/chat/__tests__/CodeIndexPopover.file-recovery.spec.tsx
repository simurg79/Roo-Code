import React from "react"
import { createInstance } from "i18next"
import userEvent from "@testing-library/user-event"
import type { FailedFileStatus, IndexingStatus } from "@roo-code/types"

import { act, render, screen, within } from "@/utils/test-utils"
import { PopoverTrigger } from "@/components/ui/popover"
import englishSettings from "@/i18n/locales/en/settings.json"
import { vscode } from "@/utils/vscode"
import { CodeIndexPopover } from "../CodeIndexPopover"

const { codebaseIndexConfig } = vi.hoisted(() => ({ codebaseIndexConfig: { codebaseIndexEnabled: true } }))

vi.mock("@/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		cwd: "C:/workspace",
		codebaseIndexConfig,
	}),
}))
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: translation.t.bind(translation) }),
}))
vi.mock("@/components/ui/hooks/useOpenRouterModelProviders", () => ({
	OPENROUTER_DEFAULT_PROVIDER_NAME: "default",
	useOpenRouterModelProviders: () => ({ data: undefined }),
}))

const translation = createInstance()
const systemStatuses = ["Standby", "Indexing", "Indexed", "Error", "Stopping"]
const retryStates = ["retrying", "exhausted"] as const
const activities = ["read", "parse", "embed", "upsert", "delete", "verify"] as const
const failedFiles: FailedFileStatus[] = activities.map((activity, index) => ({
	path: `src/failed-${activity}.ts`,
	activity,
	reason: `Latest ${activity} failure <not-markup> & details`,
	state: index % 2 === 0 ? "exhausted" : "retrying",
}))

const makeStatus = (systemStatus = "Indexing", state: FailedFileStatus["state"] = "retrying"): IndexingStatus => ({
	systemStatus,
	message: `Primary ${systemStatus} message`,
	processedItems: 2,
	totalItems: 8,
	workspaceEnabled: true,
	autoEnableDefault: false,
	failedFiles,
	failedFileSummary: { ...failedFiles[1], state, count: failedFiles.length },
})

const popover = (status: IndexingStatus) => (
	<CodeIndexPopover indexingStatus={status}>
		<PopoverTrigger asChild>
			<button>Open indexing</button>
		</PopoverTrigger>
	</CodeIndexPopover>
)

const openPopover = async (status: IndexingStatus) => {
	const user = userEvent.setup()
	const rendered = render(popover(status))
	await user.click(screen.getByRole("button", { name: "Open indexing" }))
	return { ...rendered, user }
}

const sendStatus = (status: IndexingStatus) => {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: { type: "indexingStatusUpdate", values: status } }))
	})
}

beforeAll(async () => {
	await translation.init({
		lng: "en",
		resources: { en: { settings: englishSettings } },
		interpolation: { escapeValue: false },
	})
})

beforeEach(() => {
	vi.clearAllMocks()
})

describe("CodeIndexPopover file recovery", () => {
	it.each(systemStatuses.flatMap((status) => retryStates.map((state) => ({ status, state }))))(
		"keeps $state failures and explicit retry alongside primary $status status",
		async ({ status, state }) => {
			const { user } = await openPopover(makeStatus(status, state))
			expect(screen.getByText(`Primary ${status} message`, { exact: false })).toBeVisible()
			const summary = screen.getByRole("status")
			expect(summary).toHaveTextContent("Files with indexing failures: 6.")
			expect(summary).toHaveTextContent(failedFiles[1].path)
			expect(summary).toHaveTextContent(failedFiles[1].reason)
			expect(summary).toHaveTextContent(state === "retrying" ? "Retrying" : "Automatic retry ended")
			const retryButton = screen.getByRole("button", { name: "Start Indexing" })
			expect(retryButton).toBeVisible()
			expect(retryButton).toBeEnabled()
			vi.mocked(vscode.postMessage).mockClear()
			await user.click(retryButton)
			expect(vscode.postMessage).toHaveBeenCalledTimes(1)
			expect(vscode.postMessage).toHaveBeenCalledWith({ type: "startIndexing" })
			if (status === "Indexing") {
				expect(screen.getByRole("button", { name: "Stop Indexing" })).toBeEnabled()
			}
			if (status === "Stopping") {
				expect(screen.getByRole("button", { name: englishSettings.codeIndex.stoppingButton })).toBeDisabled()
			}
		},
	)

	it("expands every failed path with its localized activity, reason and retry state, then collapses", async () => {
		const { user } = await openPopover(makeStatus())
		const disclosure = screen.getByText("Failed file details")
		const details = disclosure.closest("details")!
		expect(details).not.toHaveAttribute("open")
		expect(screen.getByText(failedFiles[0].path)).not.toBeVisible()
		await user.click(disclosure)
		expect(details).toHaveAttribute("open")
		const rows = within(details).getAllByRole("listitem")
		expect(rows).toHaveLength(failedFiles.length)
		for (const [index, failedFile] of failedFiles.entries()) {
			const row = within(rows[index])
			expect(row.getByText(failedFile.path)).toBeVisible()
			expect(row.getByText(englishSettings.codeIndex.failedFileActivities[failedFile.activity])).toBeVisible()
			expect(row.getByText(englishSettings.codeIndex.failedFileStates[failedFile.state])).toBeVisible()
			expect(row.getByText(`Reason: ${failedFile.reason}`)).toBeVisible()
		}
		await user.click(disclosure)
		expect(details).not.toHaveAttribute("open")
		expect(screen.getByText(failedFiles[0].path)).not.toBeVisible()
	})

	it("accepts live failures, preserves workspace controls, and ignores another workspace", async () => {
		await openPopover({ ...makeStatus(), failedFiles: undefined, failedFileSummary: undefined })
		expect(screen.queryByRole("status")).not.toBeInTheDocument()
		sendStatus({ ...makeStatus(), workspacePath: "C:/other", message: "Wrong workspace" })
		expect(screen.queryByText("Wrong workspace", { exact: false })).not.toBeInTheDocument()
		expect(screen.queryByRole("status")).not.toBeInTheDocument()
		sendStatus({ ...makeStatus(), workspacePath: "C:/workspace" })
		expect(screen.getByRole("status")).toHaveTextContent(failedFiles[1].path)
		expect(screen.getByLabelText(englishSettings.codeIndex.workspaceToggleLabel)).toBeChecked()
		expect(screen.getByLabelText(englishSettings.codeIndex.autoEnableDefaultLabel)).not.toBeChecked()
		sendStatus(makeStatus("Standby", "exhausted"))
		expect(screen.getByRole("status")).toHaveTextContent("Automatic retry ended")
		expect(screen.getByText("Primary Standby message", { exact: false })).toBeVisible()
	})

	it.each(["empty", "omitted"])("clears stale failures and retry when a live snapshot is %s", async (snapshot) => {
		const { user } = await openPopover(makeStatus())
		await user.click(screen.getByText("Failed file details"))
		sendStatus({
			...makeStatus("Indexed"),
			failedFiles: snapshot === "empty" ? [] : undefined,
			failedFileSummary: undefined,
		})
		expect(screen.queryByRole("status")).not.toBeInTheDocument()
		expect(screen.queryByText("Failed file details")).not.toBeInTheDocument()
		expect(screen.queryByText(failedFiles[0].path)).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Start Indexing" })).not.toBeInTheDocument()
		expect(screen.getByText("Primary Indexed message", { exact: false })).toBeVisible()
	})

	it("updates and clears failures from parent snapshots", async () => {
		const { rerender } = await openPopover(makeStatus())
		rerender(popover(makeStatus("Error", "exhausted")))
		expect(screen.getByRole("status")).toHaveTextContent("Automatic retry ended")
		rerender(popover({ ...makeStatus("Indexed"), failedFiles: [], failedFileSummary: undefined }))
		expect(screen.queryByRole("status")).not.toBeInTheDocument()
		expect(screen.queryByText("Failed file details")).not.toBeInTheDocument()
	})

	it.each(systemStatuses)("does not add failure UI to a clean %s status", async (status) => {
		await openPopover({ ...makeStatus(status), failedFiles: [], failedFileSummary: undefined })
		expect(screen.queryByRole("status")).not.toBeInTheDocument()
		expect(screen.queryByText("Failed file details")).not.toBeInTheDocument()
		const retryButton = screen.queryByRole("button", { name: "Start Indexing" })
		if (status === "Standby" || status === "Error") {
			expect(retryButton).toBeEnabled()
		} else {
			expect(retryButton).not.toBeInTheDocument()
		}
	})
})
