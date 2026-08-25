import { describe, expect, it } from 'vitest'
import { MARKER_STYLES, getMarkerShape, getMarkerSize, normalizeMarker } from './lineMarkers'

describe('normalizeMarker', () => {
	it('maps the legacy boolean and none', () => {
		expect(normalizeMarker(true)).toBe('triangle')
		expect(normalizeMarker(false)).toBeNull()
		expect(normalizeMarker('none')).toBeNull()
		expect(normalizeMarker('circle')).toBe('circle')
	})
})

describe('getMarkerShape', () => {
	it('has geometry for every style but none', () => {
		for (const style of MARKER_STYLES.filter((s) => s !== 'none')) {
			expect(getMarkerShape(style, 2)).toMatchObject({ d: expect.any(String) })
		}
		expect(getMarkerShape('none', 2)).toBeNull()
	})

	it('never pulls the line back further than the head itself', () => {
		for (const style of MARKER_STYLES) {
			const shape = getMarkerShape(style, 4)
			if (shape) expect(shape.inset).toBeLessThanOrEqual(getMarkerSize(4))
		}
	})
})
