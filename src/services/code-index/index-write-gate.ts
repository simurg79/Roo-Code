import { throwIfAborted } from "./parser-errors"

export class IndexWriteGate {
	private readonly issued = new Map<AbortSignal, Set<Promise<unknown>>>()
	private readonly uncertain = new Set<string>()

	async ready(signal: AbortSignal): Promise<void> {
		throwIfAborted(signal)
		const earlier = [...this.issued].filter(([owner]) => owner !== signal).flatMap(([, writes]) => [...writes])
		await Promise.allSettled(earlier)
		throwIfAborted(signal)
	}

	needsReconciliation(filePath: string): boolean {
		return this.uncertain.has(filePath)
	}

	reconciled(filePath: string): void {
		this.uncertain.delete(filePath)
	}

	async run<Result>(
		signal: AbortSignal,
		write: () => Result | Promise<Result>,
		files: string[] = [],
	): Promise<Result> {
		await this.ready(signal)
		throwIfAborted(signal)
		let writes = this.issued.get(signal)
		if (!writes) {
			writes = new Set()
			this.issued.set(signal, writes)
		}
		const pending = Promise.resolve().then(() => {
			throwIfAborted(signal)
			return write()
		})
		writes.add(pending)
		try {
			return await pending
		} catch (error) {
			if (!(error instanceof Error && error.name === "AbortError")) {
				for (const filePath of files) this.uncertain.add(filePath)
			}
			throw error
		} finally {
			writes.delete(pending)
			if (writes.size === 0) this.issued.delete(signal)
		}
	}
}
