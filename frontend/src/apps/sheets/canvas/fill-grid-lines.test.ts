// Regression harness for "colour formatting removes the grid lines".
//
// The canvas paints grid lines first and cell backgrounds on top, so a cell
// fill that covers its own top/left edge wipes the line that was already
// there. The result is lopsided: a filled cell keeps the lines its unfilled
// neighbours draw (bottom, right) and loses the two it owns.
//
// The checks below rasterise the renderer's real draw calls into a pixel
// buffer and read the colour back at each edge, so they state the expectation
// the way a reader of the screen would: which pixel is grid grey, which is
// fill.
import { describe, it, expect, beforeEach } from 'vitest'
import { createRenderer } from './renderer.js'
import { cellId } from '../utils/cells.js'

const GRID_LINE = '#E2E2E2' // COLORS.gridLine's fallback, with no theme set
const FILL = '#92b9c6'
const OTHER_FILL = '#f6c343'

const ROW_HEADER_W = 50
const COL_HEADER_H = 24
const COL_W = 100
const ROW_H = 24
const CANVAS_W = 400
const CANVAS_H = 200

type Rect = { x: number; y: number; w: number; h: number }
type Segment = [number, number, number, number]

// A 2D context that keeps a pixel buffer instead of a bitmap. It understands
// the shapes this paint path actually emits — axis-aligned rectangles and
// 1px-ish grid/border strokes — and ignores glyphs and round joins, which
// carry no colour at the cell edges under test.
function createRasterCtx(width: number, height: number) {
	const pixels: string[] = new Array(width * height).fill('')
	let clip: Rect = { x: 0, y: 0, w: width, h: height }
	const clipStack: Rect[] = []
	let pathRect: Rect | null = null
	let segments: Segment[] = []
	let cursor = { x: 0, y: 0 }

	const inClip = (px: number, py: number) =>
		px + 0.5 >= clip.x && px + 0.5 < clip.x + clip.w && py + 0.5 >= clip.y && py + 0.5 < clip.y + clip.h

	// Pixel centres inside the span, the usual rule for an unantialiased fill.
	const span = (from: number, extent: number): [number, number] => [
		Math.ceil(from - 0.5),
		Math.ceil(from + extent - 0.5),
	]

	function paintRect(x: number, y: number, w: number, h: number, colour: string) {
		if (w <= 0 || h <= 0) return
		const [x0, x1] = span(x, w)
		const [y0, y1] = span(y, h)
		for (let py = Math.max(0, y0); py < Math.min(height, y1); py++)
			for (let px = Math.max(0, x0); px < Math.min(width, x1); px++)
				if (inClip(px, py)) pixels[py * width + px] = colour
	}

	function paintSegment([x0, y0, x1, y1]: Segment, colour: string, lineWidth: number) {
		if (y0 === y1) paintRect(Math.min(x0, x1), y0 - lineWidth / 2, Math.abs(x1 - x0), lineWidth, colour)
		else if (x0 === x1) paintRect(x0 - lineWidth / 2, Math.min(y0, y1), lineWidth, Math.abs(y1 - y0), colour)
	}

	const ctx = {
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 1,
		font: '',
		textAlign: '',
		textBaseline: '',
		lineCap: '',
		lineJoin: '',
		lineDashOffset: 0,
		globalAlpha: 1,

		save() {
			clipStack.push(clip)
		},
		restore() {
			clip = clipStack.pop() ?? clip
		},
		scale(k: number) {
			if (k !== 1) throw new Error(`raster ctx only supports scale 1, got ${k}`)
		},
		beginPath() {
			pathRect = null
			segments = []
		},
		rect(x: number, y: number, w: number, h: number) {
			pathRect = { x, y, w, h }
		},
		clip() {
			if (!pathRect) return
			const x = Math.max(clip.x, pathRect.x)
			const y = Math.max(clip.y, pathRect.y)
			const right = Math.min(clip.x + clip.w, pathRect.x + pathRect.w)
			const bottom = Math.min(clip.y + clip.h, pathRect.y + pathRect.h)
			clip = { x, y, w: right - x, h: bottom - y }
		},
		moveTo(x: number, y: number) {
			cursor = { x, y }
		},
		lineTo(x: number, y: number) {
			segments.push([cursor.x, cursor.y, x, y])
			cursor = { x, y }
		},
		stroke() {
			for (const s of segments) paintSegment(s, ctx.strokeStyle, ctx.lineWidth)
			segments = []
		},
		strokeRect(x: number, y: number, w: number, h: number) {
			const lw = ctx.lineWidth
			for (const s of [
				[x, y, x + w, y],
				[x, y + h, x + w, y + h],
				[x, y, x, y + h],
				[x + w, y, x + w, y + h],
			] as Segment[])
				paintSegment(s, ctx.strokeStyle, lw)
		},
		fillRect: (x: number, y: number, w: number, h: number) => paintRect(x, y, w, h, ctx.fillStyle),
		closePath() {},
		fill() {},
		arc() {},
		arcTo() {},
		roundRect() {},
		fillText() {},
		setLineDash() {},
		measureText: (text: string) => ({ width: String(text).length * 7 }),

		at(x: number, y: number) {
			return pixels[y * width + x]
		},
	}
	return ctx
}

function createGeometry() {
	const cw = () => COL_W
	const rh = () => ROW_H
	return {
		cw,
		rh,
		colX: (c: number) => ROW_HEADER_W + c * COL_W,
		rowY: (r: number) => COL_HEADER_H + r * ROW_H,
		firstVisCol: () => 0,
		firstVisRow: () => 0,
		lastVisCol: () => 3,
		lastVisRow: () => 6,
		frozenW: () => 0,
		frozenH: () => 0,
		isFilterHidden: () => false,
	}
}

// Paints a grid where `fills` maps "row,col" to a background colour, and hands
// back a pixel reader. The selection sits off to the side so its own fill and
// border never touch the cells under test.
function paint(fills: Record<string, string>) {
	const ctx = createRasterCtx(CANVAS_W, CANVAS_H)
	const geo = createGeometry()
	const renderer = createRenderer(ctx as never, geo)
	const byId = new Map<string, { backgroundColor: string }>()
	for (const [key, colour] of Object.entries(fills)) {
		const [r, c] = key.split(',').map(Number)
		byId.set(cellId(r, c), { backgroundColor: colour })
	}
	renderer.render({
		cssW: CANVAS_W,
		cssH: CANVAS_H,
		getValue: () => '',
		getFormat: (id: string) => byId.get(id) ?? {},
		sel: { r: 6, c: 3 },
		selEnd: { r: 6, c: 3 },
		editing: false,
	} as never)
	return ctx
}

// Pixel coordinates of the four grid lines that frame cell (r, c), plus a
// point well inside it.
function edgesOf(r: number, c: number) {
	const x = ROW_HEADER_W + c * COL_W
	const y = COL_HEADER_H + r * ROW_H
	return {
		left: [x, y + ROW_H / 2] as const,
		right: [x + COL_W, y + ROW_H / 2] as const,
		top: [x + COL_W / 2, y] as const,
		bottom: [x + COL_W / 2, y + ROW_H] as const,
		inside: [x + COL_W / 2, y + ROW_H / 2] as const,
		insideTopLeft: [x + 1, y + 1] as const,
		insideBottomRight: [x + COL_W - 1, y + ROW_H - 1] as const,
	}
}

describe('a cell fill leaves the grid lines alone', () => {
	beforeEach(() => document.documentElement.removeAttribute('style'))

	it('keeps all four grid lines around a filled cell', () => {
		const ctx = paint({ '1,1': FILL })
		const e = edgesOf(1, 1)

		expect(ctx.at(...e.left)).toBe(GRID_LINE)
		expect(ctx.at(...e.top)).toBe(GRID_LINE)
		expect(ctx.at(...e.right)).toBe(GRID_LINE)
		expect(ctx.at(...e.bottom)).toBe(GRID_LINE)
	})

	it('still covers the whole cell interior with the fill', () => {
		const ctx = paint({ '1,1': FILL })
		const e = edgesOf(1, 1)

		expect(ctx.at(...e.inside)).toBe(FILL)
		expect(ctx.at(...e.insideTopLeft)).toBe(FILL)
		expect(ctx.at(...e.insideBottomRight)).toBe(FILL)
	})

	it('keeps the shared line between two filled neighbours', () => {
		const ctx = paint({ '1,1': FILL, '1,2': OTHER_FILL, '2,1': OTHER_FILL })
		const e = edgesOf(1, 1)

		expect(ctx.at(...e.right)).toBe(GRID_LINE)
		expect(ctx.at(...e.bottom)).toBe(GRID_LINE)
		expect(ctx.at(...edgesOf(1, 2).inside)).toBe(OTHER_FILL)
		expect(ctx.at(...edgesOf(2, 1).inside)).toBe(OTHER_FILL)
	})

	it('keeps the grid lines around a filled block of cells', () => {
		const fills: Record<string, string> = {}
		for (let r = 0; r <= 4; r++) fills[`${r},1`] = r % 2 === 0 ? FILL : '#ffffff'
		const ctx = paint(fills)

		for (let r = 0; r <= 4; r++) {
			const e = edgesOf(r, 1)
			expect(ctx.at(...e.left), `row ${r} left`).toBe(GRID_LINE)
			expect(ctx.at(...e.top), `row ${r} top`).toBe(GRID_LINE)
			expect(ctx.at(...e.right), `row ${r} right`).toBe(GRID_LINE)
		}
	})
})
