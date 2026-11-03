export function delegationText(text: string): string {
	return text.replace(/\\\\@/g, "\\@")
}
