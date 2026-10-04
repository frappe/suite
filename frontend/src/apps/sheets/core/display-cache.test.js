import { describe, it, expect } from 'vitest'
import { createDisplayCache } from './display-cache.js'

const bold = { style: { font: { b: true } } }

describe('display cache — fill and read', () => {
	it('misses before a fill and hits after', () => {
		const cache = createDisplayCache()
		expect(cache.get('Sheet1', 1, 1)).toBeUndefined()
		expect(cache.fill('Sheet1', 1, 1, { values: [['a', ''], ['b', 'c']] }, 0)).toBe(true)
		expect(cache.get('Sheet1', 1, 1)).toEqual({ display: 'a' })
		expect(cache.get('Sheet1', 1, 2)).toEqual({ display: '' })
		expect(cache.get('Sheet1', 2, 2)).toEqual({ display: 'c' })
		expect(cache.size).toBe(4)
	})

	it('offsets values by the top-left cell', () => {
		const cache = createDisplayCache()
		cache.fill('Sheet1', 10, 5, { values: [['x']] }, 0)
		expect(cache.get('Sheet1', 10, 5)).toEqual({ display: 'x' })
		expect(cache.get('Sheet1', 1, 1)).toBeUndefined()
	})

	it('keys by sheet', () => {
		const cache = createDisplayCache()
		cache.fill('Sheet1', 1, 1, { values: [['one']] }, 0)
		expect(cache.get('Sheet2', 1, 1)).toBeUndefined()
	})

	it('stores styles when given and keeps them on a values-only fill', () => {
		const cache = createDisplayCache()
		cache.fill('Sheet1', 1, 1, { values: [['a']], styles: [[bold]] }, 0)
		expect(cache.get('Sheet1', 1, 1)).toEqual({ display: 'a', style: bold })
		cache.fill('Sheet1', 1, 1, { values: [['b']] }, 0)
		expect(cache.get('Sheet1', 1, 1)).toEqual({ display: 'b', style: bold })
	})
})

describe('display cache — versions', () => {
	it('clear empties the cache and moves to the new version', () => {
		const cache = createDisplayCache()
		cache.fill('Sheet1', 1, 1, { values: [['a']] }, 0)
		cache.clear(1)
		expect(cache.size).toBe(0)
		expect(cache.version).toBe(1)
	})

	it('drops a fill read at an older version', () => {
		const cache = createDisplayCache()
		cache.clear(3)
		expect(cache.fill('Sheet1', 1, 1, { values: [['stale']] }, 2)).toBe(false)
		expect(cache.get('Sheet1', 1, 1)).toBeUndefined()
	})
})

describe('display cache — provisional echo', () => {
	it('marks echoed text provisional and keeps the existing style', () => {
		const cache = createDisplayCache()
		cache.fill('Sheet1', 1, 1, { values: [['old']], styles: [[bold]] }, 0)
		cache.setProvisional('Sheet1', 1, 1, 'new')
		expect(cache.get('Sheet1', 1, 1)).toEqual({ display: 'new', style: bold, provisional: true })
	})

	it('survives clear and fill until settled', () => {
		const cache = createDisplayCache()
		cache.setProvisional('Sheet1', 1, 1, 'typed')
		cache.clear(1)
		cache.fill('Sheet1', 1, 1, { values: [['engine']] }, 1)
		expect(cache.get('Sheet1', 1, 1)?.display).toBe('typed')

		cache.settleProvisional('Sheet1', 1, 1)
		expect(cache.get('Sheet1', 1, 1)).toBeUndefined()
		cache.fill('Sheet1', 1, 1, { values: [['engine']] }, 1)
		expect(cache.get('Sheet1', 1, 1)).toEqual({ display: 'engine' })
	})

	it('needs one settle per echo when a cell is typed twice', () => {
		const cache = createDisplayCache()
		cache.setProvisional('Sheet1', 1, 1, 'one')
		cache.setProvisional('Sheet1', 1, 1, 'two')
		cache.settleProvisional('Sheet1', 1, 1)
		expect(cache.get('Sheet1', 1, 1)).toEqual({ display: 'two', provisional: true })
		cache.settleProvisional('Sheet1', 1, 1)
		expect(cache.get('Sheet1', 1, 1)).toBeUndefined()
	})

	it('ignores a settle with nothing pending', () => {
		const cache = createDisplayCache()
		cache.fill('Sheet1', 1, 1, { values: [['a']] }, 0)
		cache.settleProvisional('Sheet1', 1, 1)
		expect(cache.get('Sheet1', 1, 1)).toEqual({ display: 'a' })
	})
})
