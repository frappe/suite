import { describe, expect, it, vi } from 'vitest'

// resize.js reaches mediaUploads via helpers.ts, which drags in the whole app
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

import {
	clipToBoundary,
	containsPoint,
	getAnchorPoint,
	getElbowPath,
	getElbowPathData,
	getLineBox,
	getLineEndpoints,
	remapElementIds,
	getPort,
	resolveAutoSide,
	routeConnector,
	routeElbow,
	snapToPort,
} from './connectors'

const box = (overrides = {}) => ({ left: 100, top: 100, width: 200, height: 100, rotation: 0, ...overrides })

const closeTo = (point, expected) => {
	expect(point.x).toBeCloseTo(expected.x, 6)
	expect(point.y).toBeCloseTo(expected.y, 6)
}

describe('getAnchorPoint', () => {
	it('returns side midpoints, rotated about the centre', () => {
		closeTo(getAnchorPoint(box(), 'top'), { x: 200, y: 100 })
		closeTo(getAnchorPoint(box(), 'left'), { x: 100, y: 150 })
		closeTo(getAnchorPoint(box({ rotation: 90 }), 'top'), { x: 250, y: 150 })
	})
})

describe('containsPoint', () => {
	it('tests against the rotated box', () => {
		expect(containsPoint(box(), { x: 150, y: 150 })).toBe(true)
		expect(containsPoint(box(), { x: 99, y: 150 })).toBe(false)
		// a 90° box of 200×100 spans y 50..250 at its centre column
		expect(containsPoint(box({ rotation: 90 }), { x: 200, y: 60 })).toBe(true)
		expect(containsPoint(box({ rotation: 90 }), { x: 110, y: 110 })).toBe(false)
	})
})

describe('snapToPort', () => {
	it('picks the port within reach and nothing between them', () => {
		expect(snapToPort(box(), { x: 290, y: 155 }, 14)).toBe('right')
		expect(snapToPort(box(), { x: 250, y: 150 }, 14)).toBeNull()
		expect(snapToPort(box(), { x: 290, y: 155 }, 5)).toBeNull()
	})
})

describe('getPort', () => {
	it('matches the anchor for rectangles, ovals and diamonds', () => {
		for (const shapeType of ['rectangle', 'oval', 'diamond', undefined]) {
			for (const side of ['top', 'right', 'bottom', 'left']) {
				closeTo(getPort(box({ shapeType }), side), getAnchorPoint(box({ shapeType }), side))
			}
		}
	})

	it('puts triangle side ports on the slanted edges, not the bounding box', () => {
		const triangle = box({ shapeType: 'triangle', width: 200, height: 200 })
		closeTo(getPort(triangle, 'top'), { x: 200, y: 100 })
		closeTo(getPort(triangle, 'bottom'), { x: 200, y: 300 })
		// left edge runs from the apex (200,100) to (100,300); the horizontal ray
		// from the centre (200,200) meets it halfway
		closeTo(getPort(triangle, 'left'), { x: 150, y: 200 })
		closeTo(getPort(triangle, 'right'), { x: 250, y: 200 })
	})
})

describe('clipToBoundary', () => {
	it('exits a rectangle where the centre ray crosses its edge', () => {
		closeTo(clipToBoundary(box(), { x: 600, y: 150 }), { x: 300, y: 150 })
		closeTo(clipToBoundary(box(), { x: 300, y: 400 }), { x: 220, y: 200 })
	})

	it('exits an oval on the ellipse', () => {
		const oval = box({ shapeType: 'oval', width: 200, height: 100 })
		const point = clipToBoundary(oval, { x: 400, y: 300 })
		const dx = (point.x - 200) / 100
		const dy = (point.y - 150) / 50
		expect(dx * dx + dy * dy).toBeCloseTo(1, 6)
	})

	it('honours rotation', () => {
		const rotated = box({ rotation: 90, width: 200, height: 100 })
		// rotated 90°, the box spans x 150..250 and y 50..250
		closeTo(clipToBoundary(rotated, { x: 600, y: 150 }), { x: 250, y: 150 })
	})
})

describe('resolveAutoSide', () => {
	it('picks the side the centre ray leaves through, box aspect included', () => {
		expect(resolveAutoSide(box(), { x: 600, y: 150 })).toBe('right')
		expect(resolveAutoSide(box(), { x: 200, y: -100 })).toBe('top')
		// slightly above the diagonal of a wide box is still "right" by angle,
		// but the ray leaves through the top edge
		expect(resolveAutoSide(box(), { x: 320, y: 30 })).toBe('top')
	})

	it('follows rotation', () => {
		// rotated 90° clockwise the top side faces right
		expect(resolveAutoSide(box({ rotation: 90 }), { x: 600, y: 150 })).toBe('top')
	})

	it('holds the previous side within the hysteresis band', () => {
		const square = box({ width: 100, height: 100 })
		const atAngle = (degrees) => ({
			x: 150 + Math.cos((degrees * Math.PI) / 180) * 100,
			y: 150 + Math.sin((degrees * Math.PI) / 180) * 100,
		})
		// just past the bottom-right diagonal
		expect(resolveAutoSide(square, atAngle(46))).toBe('bottom')
		expect(resolveAutoSide(square, atAngle(46), 'right')).toBe('right')
		// well past the band it switches
		expect(resolveAutoSide(square, atAngle(50), 'right')).toBe('bottom')
	})
})

describe('routeConnector', () => {
	const rect = (left: number, top: number) => ({
		left,
		top,
		width: 100,
		height: 100,
		rotation: 0,
		shapeType: 'rectangle',
	})
	const line = (connector: any) => ({
		left: 0,
		top: 0,
		width: 100,
		height: 4,
		rotation: 0,
		strokeWidth: 4,
		connector,
	})

	it('joins two fixed ports and puts the centre line on them', () => {
		const box = routeConnector(
			line({ start: { anchor: 'right' }, end: { anchor: 'left' } }),
			rect(0, 0),
			rect(300, 0),
		)
		expect(box).toMatchObject({ left: 100, top: 48, width: 200, height: 4, rotation: 0 })
	})

	it('puts an auto end on the port facing the other target', () => {
		const box = routeConnector(
			line({ start: { anchor: 'auto' }, end: { anchor: 'auto' } }),
			rect(0, 0),
			rect(0, 300),
		)
		expect(box.rotation).toBe(90)
		expect(box.width).toBe(200)
	})

	it('keeps a free end where the line has it', () => {
		const box = routeConnector(line({ start: { anchor: 'right' }, end: null }), rect(0, 0), null)
		const { end } = getLineEndpoints({ ...box, strokeWidth: 4 })
		expect(end.x).toBeCloseTo(100)
		expect(end.y).toBeCloseTo(2)
	})
})

describe('getElbowPath', () => {
	const bounds = (left: number, top: number, size = 100) => ({
		left,
		top,
		right: left + size,
		bottom: top + size,
	})
	const RIGHT = { x: 1, y: 0 }
	const LEFT = { x: -1, y: 0 }
	const UP = { x: 0, y: -1 }
	const DOWN = { x: 0, y: 1 }
	const a = bounds(0, 0)
	const fromRightOfA = { start: { x: 100, y: 50 }, startNormal: RIGHT, startBounds: a }

	it('makes an L when the ports face round a corner', () => {
		const path = getElbowPath({
			...fromRightOfA,
			end: { x: 350, y: 200 },
			endNormal: UP,
			endBounds: bounds(300, 200),
		})
		expect(path).toEqual([
			{ x: 100, y: 50 },
			{ x: 350, y: 50 },
			{ x: 350, y: 200 },
		])
	})

	it('makes a Z on the mid-line when the ports face each other', () => {
		const path = getElbowPath({
			...fromRightOfA,
			end: { x: 300, y: 250 },
			endNormal: LEFT,
			endBounds: bounds(300, 200),
		})
		expect(path).toEqual([
			{ x: 100, y: 50 },
			{ x: 200, y: 50 },
			{ x: 200, y: 250 },
			{ x: 300, y: 250 },
		])
	})

	it('goes round the target to reach a port facing away', () => {
		const path = getElbowPath({
			...fromRightOfA,
			end: { x: 350, y: 100 },
			endNormal: DOWN,
			endBounds: bounds(300, 0),
		})
		expect(path).toEqual([
			{ x: 100, y: 50 },
			{ x: 237, y: 50 },
			{ x: 237, y: 124 },
			{ x: 350, y: 124 },
			{ x: 350, y: 100 },
		])
	})

	it('loops over both boxes when the ports face the same way', () => {
		const path = getElbowPath({
			...fromRightOfA,
			end: { x: 400, y: 50 },
			endNormal: RIGHT,
			endBounds: bounds(300, 0),
		})
		expect(path).toEqual([
			{ x: 100, y: 50 },
			{ x: 124, y: 50 },
			{ x: 124, y: -24 },
			{ x: 424, y: -24 },
			{ x: 424, y: 50 },
			{ x: 400, y: 50 },
		])
	})

	it('shortens the stub when the boxes are closer than two stubs', () => {
		const path = getElbowPath({
			...fromRightOfA,
			end: { x: 130, y: 250 },
			endNormal: LEFT,
			endBounds: bounds(130, 200),
		})
		expect(path).toEqual([
			{ x: 100, y: 50 },
			{ x: 115, y: 50 },
			{ x: 115, y: 250 },
			{ x: 130, y: 250 },
		])
	})

	it('falls back to a straight line for overlapping boxes', () => {
		const path = getElbowPath({
			...fromRightOfA,
			end: { x: 50, y: 150 },
			endNormal: DOWN,
			endBounds: bounds(50, 50),
		})
		expect(path).toEqual([
			{ x: 100, y: 50 },
			{ x: 50, y: 150 },
		])
	})

	it('leaves a free end along the axis of the larger delta', () => {
		const path = getElbowPath({
			start: { x: 0, y: 0 },
			end: { x: 300, y: 100 },
			startNormal: null,
			endNormal: null,
			startBounds: null,
			endBounds: null,
		})
		expect(path).toEqual([
			{ x: 0, y: 0 },
			{ x: 150, y: 0 },
			{ x: 150, y: 100 },
			{ x: 300, y: 100 },
		])
	})

	it('snaps a rotated normal to the nearest axis', () => {
		const path = getElbowPath({
			...fromRightOfA,
			startNormal: { x: 0.9, y: 0.4 },
			end: { x: 300, y: 250 },
			endNormal: LEFT,
			endBounds: bounds(300, 200),
		})
		expect(path[1]).toEqual({ x: 200, y: 50 })
	})
})

describe('routeElbow', () => {
	it('boxes the route and stores the points relative to it', () => {
		const rect = (left: number, top: number) => ({
			left,
			top,
			width: 100,
			height: 100,
			rotation: 0,
			shapeType: 'rectangle',
		})
		const line = {
			left: 0,
			top: 0,
			width: 100,
			height: 4,
			rotation: 0,
			strokeWidth: 4,
			connector: { route: 'elbow', start: { anchor: 'right' }, end: { anchor: 'left' } },
		}
		expect(routeElbow(line, rect(0, 0), rect(300, 200))).toEqual({
			left: 100,
			top: 50,
			width: 200,
			height: 200,
			rotation: 0,
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 200 },
				{ x: 200, y: 200 },
			],
		})
	})

	it('keeps a free end of an existing elbow where it is', () => {
		const line = {
			id: 'e',
			left: 100,
			top: 50,
			width: 200,
			height: 200,
			rotation: 0,
			strokeWidth: 4,
			points: [
				{ x: 0, y: 0 },
				{ x: 200, y: 200 },
			],
			connector: { route: 'elbow', start: { anchor: 'right' }, end: null },
		}
		const box = routeElbow(line, { left: 0, top: 0, width: 100, height: 100, rotation: 0 }, null)
		const last = box.points.at(-1)
		expect(box.left + last.x).toBe(300)
		expect(box.top + last.y).toBe(250)
	})

	it('boxes a straight route with a zero extent, not a missing one', () => {
		const rect = (left: number) => ({ left, top: 0, width: 100, height: 100, rotation: 0 })
		const line = {
			id: 'f',
			left: 0,
			top: 0,
			width: 100,
			height: 4,
			rotation: 0,
			strokeWidth: 4,
			connector: { route: 'elbow', start: { anchor: 'auto' }, end: { anchor: 'auto' } },
		}
		expect(routeElbow(line, rect(0), rect(300))).toEqual({
			left: 100,
			top: 50,
			width: 200,
			height: 0,
			rotation: 0,
			points: [
				{ x: 0, y: 0 },
				{ x: 200, y: 0 },
			],
		})
	})
})

describe('getElbowPathData', () => {
	it('rounds corners and pulls the ends back by the marker insets', () => {
		const d = getElbowPathData(
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 100 },
			],
			4,
			6,
		)
		expect(d).toBe('M 4 0 L 92 0 Q 100 0 100 8 L 100 94')
	})

	it('caps the corner radius at half the shorter segment', () => {
		const d = getElbowPathData([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 100 },
		])
		expect(d).toBe('M 0 0 L 5 0 Q 10 0 10 8 L 10 100')
	})
})

describe('line endpoints', () => {
	it('round-trip through getLineBox', () => {
		const start = { x: 10, y: 20 }
		const end = { x: 110, y: 120 }
		const box = getLineBox(start, end, 6)
		const endpoints = getLineEndpoints({ ...box, strokeWidth: 6 })
		expect(endpoints.start.x).toBeCloseTo(10)
		expect(endpoints.start.y).toBeCloseTo(20)
		expect(endpoints.end.x).toBeCloseTo(110)
		expect(endpoints.end.y).toBeCloseTo(120)
	})
})

describe('remapElementIds', () => {
	it('points copied bindings at the copies and drops the rest', () => {
		const copies = remapElementIds([
			{ id: 'a' },
			{
				id: 'c',
				connector: {
					route: 'straight',
					start: { elementId: 'a', anchor: 'right' },
					end: { elementId: 'b', anchor: 'auto' },
				},
			},
		] as any)

		expect(copies[0].id).not.toBe('a')
		expect(copies[1].connector.start).toEqual({ elementId: copies[0].id, anchor: 'right' })
		expect(copies[1].connector.end).toBeNull()
	})

	it('gives every element its own id even when the sources share one', () => {
		const copies = remapElementIds([{ id: 'a' }, { id: 'a' }, {}, {}] as any)
		expect(new Set(copies.map((copy) => copy.id)).size).toBe(4)
	})
})
