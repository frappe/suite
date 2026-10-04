import { describe, it, expect, vi } from 'vitest'
import { createDisplayCache } from './display-cache.js'
import { createCellProvider } from './cell-provider.js'

// A client stub whose readViewport answers with "r{row}c{col}" per cell,
// and whose version can be bumped by hand.
function stubClient() {
	let version = 0
	const listeners = new Set()
	const client = {
		reads: [],
		getVersion: () => version,
		onVersion(cb) { listeners.add(cb); return () => listeners.delete(cb) },
		bump() { version += 1; for (const cb of listeners) cb(version) },
		readViewport: vi.fn(async box => {
			client.reads.push(box)
			const values = []
			for (let r = box.r1; r <= box.r2; r++) {
				const row = []
				for (let c = box.c1; c <= box.c2; c++) row.push(`r${r}c${c}`)
				values.push(row)
			}
			return { values }
		}),
	}
	return client
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function setup(opts = {}) {
	const client = stubClient()
	const cache = createDisplayCache()
	const requestRender = vi.fn()
	const provider = createCellProvider({ client, cache, requestRender, overscanRows: 0, overscanCols: 0, ...opts })
	return { client, cache, requestRender, provider }
}

describe('cell provider', () => {
	it('returns blank on a miss, then the value after the refill', async () => {
		const { provider, requestRender } = setup()
		expect(provider.getDisplay('Sheet1', 2, 3)).toBe('')
		await settle()
		expect(requestRender).toHaveBeenCalledTimes(1)
		expect(provider.getDisplay('Sheet1', 2, 3)).toBe('r2c3')
	})

	it('turns one paint worth of misses into one read of their bounding box', async () => {
		const { provider, client } = setup()
		for (let r = 1; r <= 3; r++) for (let c = 1; c <= 4; c++) provider.getDisplay('Sheet1', r, c)
		await settle()
		expect(client.reads).toEqual([{ sheet: 'Sheet1', r1: 1, c1: 1, r2: 3, c2: 4 }])
	})

	it('adds overscan, clamped at row and column 1', async () => {
		const { provider, client } = setup({ overscanRows: 5, overscanCols: 2 })
		provider.getDisplay('Sheet1', 3, 2)
		await settle()
		expect(client.reads[0]).toEqual({ sheet: 'Sheet1', r1: 1, c1: 1, r2: 8, c2: 4 })
	})

	it('does not read again for cells already cached', async () => {
		const { provider, client } = setup()
		provider.getDisplay('Sheet1', 1, 1)
		await settle()
		provider.getDisplay('Sheet1', 1, 1)
		await settle()
		expect(client.reads).toHaveLength(1)
	})

	it('clears and repaints on a version bump, then refetches', async () => {
		const { provider, client, cache, requestRender } = setup()
		provider.getDisplay('Sheet1', 1, 1)
		await settle()
		client.bump()
		expect(cache.size).toBe(0)
		expect(requestRender).toHaveBeenCalledTimes(2)
		expect(provider.getDisplay('Sheet1', 1, 1)).toBe('')
		await settle()
		expect(client.reads).toHaveLength(2)
	})

	it('drops a read that finished after the version moved', async () => {
		const { provider, client, cache } = setup()
		let reply
		client.readViewport.mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
		provider.getDisplay('Sheet1', 1, 1)
		await settle() // the read is out, asked at version 0
		client.bump()
		reply({ values: [['stale']] })
		await settle()
		expect(cache.get('Sheet1', 1, 1)).toBeUndefined()
	})

	it('forgets misses from a sheet the canvas stopped painting', async () => {
		const { provider, client } = setup()
		provider.getDisplay('Sheet1', 1, 1)
		provider.getDisplay('Sheet2', 5, 5)
		await settle()
		expect(client.reads).toEqual([{ sheet: 'Sheet2', r1: 5, c1: 5, r2: 5, c2: 5 }])
	})

	it('reports a failed read and does not repaint', async () => {
		const onError = vi.fn()
		const { provider, client, requestRender } = setup({ onError })
		client.readViewport.mockRejectedValueOnce(new Error('unknown sheet'))
		provider.getDisplay('Nope', 1, 1)
		await settle()
		expect(onError).toHaveBeenCalledTimes(1)
		expect(requestRender).not.toHaveBeenCalled()
	})

	it('catches the cache up to a client that is already past version 0', async () => {
		const client = stubClient()
		client.bump()
		client.bump() // e.g. the import batch, applied before the provider exists
		const cache = createDisplayCache()
		const provider = createCellProvider({ client, cache, requestRender: () => {}, overscanRows: 0, overscanCols: 0 })
		provider.getDisplay('Sheet1', 1, 1)
		await settle()
		expect(provider.getDisplay('Sheet1', 1, 1)).toBe('r1c1')
	})

	it('stops listening after dispose', async () => {
		const { provider, client, requestRender } = setup()
		provider.dispose()
		client.bump()
		expect(requestRender).not.toHaveBeenCalled()
	})
})
