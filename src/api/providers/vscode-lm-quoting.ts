const QUOTING_CUE =
	/\b(?:(?:never|not|do not|don't|does not|doesn't|must not|mustn't|avoid|instead of|rather than|for example|such as|like this|as follows)\b|e\.g\.)/gi

class CueState {
	private tail = ""
	private offset = 0
	private tailPrecededByWord = false
	private lastTerminator = -1
	private lastCueEnd = -1

	advance(text: string): void {
		const combined = this.tail + text
		const origin = this.offset - this.tail.length
		for (const cue of combined.matchAll(QUOTING_CUE)) {
			// A cue at the chunk end needs the next character to confirm its word boundary.
			if (!(cue.index === 0 && this.tailPrecededByWord) && cue.index + cue[0].length < combined.length) {
				this.lastCueEnd = Math.max(this.lastCueEnd, origin + cue.index + cue[0].length)
			}
		}
		this.lastTerminator = Math.max(
			this.lastTerminator,
			combined.lastIndexOf(".") < 0 ? -1 : origin + combined.lastIndexOf("."),
			combined.lastIndexOf("!") < 0 ? -1 : origin + combined.lastIndexOf("!"),
			combined.lastIndexOf("?") < 0 ? -1 : origin + combined.lastIndexOf("?"),
		)
		this.offset += text.length
		if (combined.length > 24) this.tailPrecededByWord = /[A-Za-z0-9_]/.test(combined[combined.length - 25])
		this.tail = combined.slice(-24)
	}

	hasCue(): boolean {
		let cueEnd = this.lastCueEnd
		const origin = this.offset - this.tail.length
		for (const cue of this.tail.matchAll(QUOTING_CUE)) {
			if (!(cue.index === 0 && this.tailPrecededByWord)) {
				cueEnd = Math.max(cueEnd, origin + cue.index + cue[0].length)
			}
		}
		return cueEnd > this.lastTerminator
	}

	copy(): CueState {
		const result = new CueState()
		Object.assign(result, this)
		return result
	}
}

// Scan only new text; invoke bodies must not affect later quoting decisions.
export class QuotingScanState {
	private openFence: { marker: string; width: number } | null = null
	private wrapperOpen = false
	private inlineWidth = 0
	private pendingBackticks = 0
	private cue = new CueState()
	private pendingTags: string[] = []
	private fencePrefix = ""
	private fenceMarker = ""
	private fenceWidth = 0
	private fenceRunComplete = false
	private fenceSuffixHasBacktick = false
	private fenceSuffixHasText = false

	advance(span: string): void {
		const wrapperPattern = /<(\/?)(?:antml:)?function_calls\s*>/gi
		let consumed = 0
		for (const tag of span.matchAll(wrapperPattern)) {
			this.advanceText(span.slice(consumed, tag.index))
			this.finishBackticks()
			if (this.inlineWidth === 0) {
				if (tag[1]) this.wrapperOpen = false
				else if (this.openFence === null && this.fenceWidth < 3) this.wrapperOpen = true
			}
			this.advanceText(tag[0])
			consumed = tag.index + tag[0].length
		}
		this.advanceText(span.slice(consumed))
	}

	private advanceText(text: string): void {
		let visible = ""
		const flushVisible = () => {
			if (visible) this.cue.advance(visible)
			visible = ""
		}
		for (const character of text) {
			if (character === "\n") {
				flushVisible()
				this.openFence = this.fenceAfterCurrentLine()
				this.inlineWidth = 0
				this.pendingBackticks = 0
				this.cue = new CueState()
				this.pendingTags = []
				this.fencePrefix = ""
				this.fenceMarker = ""
				this.fenceWidth = 0
				this.fenceRunComplete = false
				this.fenceSuffixHasBacktick = false
				this.fenceSuffixHasText = false
				continue
			}
			this.advanceFence(character)
			if (character === "`") this.pendingBackticks++
			else this.finishBackticks()
			if (character === "<") {
				flushVisible()
				this.pendingTags.push("")
			} else if (character === ">" && this.pendingTags.length) {
				this.pendingTags.pop()
			} else if (this.pendingTags.length) {
				this.pendingTags[this.pendingTags.length - 1] += character
			} else visible += character
		}
		flushVisible()
	}

	private finishBackticks(): void {
		if (!this.pendingBackticks) return
		if (this.inlineWidth === 0) this.inlineWidth = this.pendingBackticks
		else if (this.inlineWidth === this.pendingBackticks) this.inlineWidth = 0
		this.pendingBackticks = 0
	}

	private advanceFence(character: string): void {
		if (!this.fenceMarker) {
			if (this.fencePrefix.length < 3 && character === " ") this.fencePrefix += character
			else if (this.fencePrefix.trim() === "" && (character === "`" || character === "~")) {
				this.fenceMarker = character
				this.fenceWidth = 1
			} else this.fencePrefix = "invalid"
			return
		}
		if (!this.fenceRunComplete && character === this.fenceMarker) this.fenceWidth++
		else {
			this.fenceRunComplete = true
			this.fenceSuffixHasBacktick ||= character === "`"
			this.fenceSuffixHasText ||= character.trim() !== ""
		}
	}

	private fenceAfterCurrentLine(): { marker: string; width: number } | null {
		if (this.fenceWidth < 3) return this.openFence
		if (!this.openFence) {
			return this.fenceMarker === "`" && this.fenceSuffixHasBacktick
				? null
				: { marker: this.fenceMarker, width: this.fenceWidth }
		}
		return this.fenceMarker === this.openFence.marker &&
			this.fenceWidth >= this.openFence.width &&
			!this.fenceSuffixHasText
			? null
			: this.openFence
	}

	isInsideCodeFence(): boolean {
		return this.fenceAfterCurrentLine() !== null
	}
	hasOddBacktickCountOnLine(): boolean {
		this.finishBackticks()
		return this.inlineWidth !== 0
	}
	isInsideFunctionCallsWrapper(): boolean {
		return this.wrapperOpen
	}
	hasQuotingCue(): boolean {
		if (!this.pendingTags.length) return this.cue.hasCue()
		const pendingCue = this.cue.copy()
		for (const pending of this.pendingTags) pendingCue.advance(`<${pending}`)
		return pendingCue.hasCue()
	}
}
