export interface ICacheManager {
	getHash(filePath: string): string | undefined
	isTracked(filePath: string): boolean
	flush(): Promise<void>
	getAllHashes(): Record<string, string>
	getOpenFiles(): Record<string, true>
	getTrackedPaths(): string[]
	invalidateFile(filePath: string): Promise<void>
	completeFile(filePath: string, hash: string): void
	completeRemoval(filePath: string): void
	saveNow(): Promise<void>
	readonly generationWatermark: number | undefined
	reserveGenerations(watermark: number): Promise<void>
}
