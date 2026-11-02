import { QdrantClient } from "@qdrant/js-client-rest"
import { createHash, randomUUID } from "node:crypto"
import { createServer, request as httpRequest, Server } from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import { QdrantVectorStore } from "../qdrant-client"

vi.mock("../../../../i18n", () => ({ t: (key: string) => key }))

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((complete) => {
		resolve = complete
	})
	return { promise, resolve }
}

const qdrantUrl = process.env.QDRANT_INTEGRATION_URL ?? "http://127.0.0.1:16333"
const client = new QdrantClient({ url: qdrantUrl })
let store: QdrantVectorStore
let collectionName: string
let workspacePath: string
let proxy: Server
let delayedStore: QdrantVectorStore
let heldDelete: { arrived: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined

beforeEach(async () => {
	workspacePath = path.resolve(`qdrant-t23-${randomUUID()}`)
	collectionName = `ws-${createHash("sha256").update(workspacePath).digest("hex").substring(0, 16)}`
	store = new QdrantVectorStore(workspacePath, qdrantUrl, 2)
	await store.initialize()
	proxy = createServer(async (incoming, outgoing) => {
		if (incoming.url?.includes("/points/delete") && heldDelete) {
			const held = heldDelete
			held.arrived.resolve()
			await held.release.promise
		}
		const upstream = httpRequest(
			new URL(incoming.url!, qdrantUrl),
			{
				method: incoming.method,
				headers: { ...incoming.headers, host: new URL(qdrantUrl).host },
			},
			(response) => {
				outgoing.writeHead(response.statusCode!, response.headers)
				response.pipe(outgoing)
			},
		)
		upstream.on("error", (error) => {
			outgoing.writeHead(502)
			outgoing.end(error.message)
		})
		incoming.pipe(upstream)
	})
	await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
	const proxyPort = (proxy.address() as AddressInfo).port
	delayedStore = new QdrantVectorStore(workspacePath, `http://127.0.0.1:${proxyPort}`, 2)
})

afterEach(async () => {
	heldDelete?.release.resolve()
	heldDelete = undefined
	if (proxy) await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())))
	await client.deleteCollection(collectionName)
})

function point(filePath: string, generation?: number) {
	return {
		id: randomUUID(),
		vector: [1, 0],
		payload: { filePath, ...(generation === undefined ? {} : { generation }) },
	}
}

describe("T23 real Qdrant generation fencing", () => {
	it("creates the integer index and exact counts include legacy, older, and newer points", async () => {
		const info = await client.getCollection(collectionName)
		expect(info.payload_schema?.generation?.data_type).toBe("integer")
		expect(info.payload_schema?.filePath?.data_type).toBe("keyword")
		expect(info.payload_schema?.type?.data_type).toBe("keyword")
		for (let segment = 0; segment <= 4; segment++) {
			expect(info.payload_schema?.[`pathSegments.${segment}`]?.data_type).toBe("keyword")
		}
		await store.upsertPoints([
			point("file.ts"),
			point("file.ts", 1),
			point("file.ts", 2),
			point("file.ts", 2),
			point("file.ts", 3),
			point(path.join("file.ts", "child"), 1),
			point("unrelated.ts", 2),
		])
		expect(await store.countPointsForFile(path.join(workspacePath, "file.ts"), 2)).toEqual({ current: 2, other: 3 })
		await store.deletePointsByFilePath("file.ts", 2)
		expect(await store.countPointsForFile("file.ts", 2)).toEqual({ current: 2, other: 1 })
		expect(await store.countPointsForFile(path.join("file.ts", "child"), 1)).toEqual({ current: 1, other: 0 })
		expect(await store.countPointsForFile("unrelated.ts", 2)).toEqual({ current: 1, other: 0 })
		expect(await store.countPointsForFile("missing.ts", 2)).toEqual({ current: 0, other: 0 })
		await store.deletePointsByMultipleFilePaths([path.join("file.ts", "child"), "unrelated.ts"], 3)
		expect(await store.countPointsForFile(path.join("file.ts", "child"), 1)).toEqual({ current: 0, other: 0 })
		expect(await store.countPointsForFile("unrelated.ts", 2)).toEqual({ current: 0, other: 0 })
	})

	it.each(["cleanup", "removal"])(
		"a delayed old %s executes after retry verification without removing new points",
		async () => {
			await store.upsertPoints([point("file.ts"), point("file.ts", 1)])
			heldDelete = { arrived: deferred(), release: deferred() }
			const pendingDelete = delayedStore.deletePointsByFilePath("file.ts", 2)
			await heldDelete.arrived.promise
			try {
				await store.upsertPoints([point("file.ts", 3), point("file.ts", 3)])
				await store.deletePointsByFilePath("file.ts", 3)
				expect(await store.countPointsForFile("file.ts", 3)).toEqual({ current: 2, other: 0 })
				// These older points arrive after the request was issued, but before its remote execution.
				await store.upsertPoints([point("file.ts"), point("file.ts", 1), point("unrelated.ts", 1)])
			} finally {
				heldDelete.release.resolve()
				await pendingDelete
			}
			const counts = await store.countPointsForFile("file.ts", 3)
			if (counts.other !== 0) {
				console.log(
					"T23 unexpected retained points",
					JSON.stringify(await client.scroll(collectionName, { with_payload: true })),
				)
			}
			expect(counts).toEqual({ current: 2, other: 0 })
			expect(await store.countPointsForFile("unrelated.ts", 1)).toEqual({ current: 1, other: 0 })
		},
	)

	it("detects a late old upsert without overwriting current generation IDs", async () => {
		const currentPoint = point("file.ts", 3)
		await store.upsertPoints([currentPoint])
		await store.deletePointsByFilePath("file.ts", 3)
		expect(await store.countPointsForFile("file.ts", 3)).toEqual({ current: 1, other: 0 })
		const startedAt = performance.now()
		await store.upsertPoints([point("file.ts", 1)])
		expect(await store.countPointsForFile("file.ts", 3)).toEqual({ current: 1, other: 1 })
		const retained = await client.retrieve(collectionName, { ids: [currentPoint.id], with_payload: true })
		expect(retained[0].payload?.generation).toBe(3)
		console.log(`T23 local late-upsert visibility: ${(performance.now() - startedAt).toFixed(2)} ms`)
		await store.deletePointsByFilePath("file.ts", 3)
		expect(await store.countPointsForFile("file.ts", 3)).toEqual({ current: 1, other: 0 })
	})
})
