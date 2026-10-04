// Types for geometry.js, so strict TypeScript can import it.
//
// Cell ↔ pixel maths for the grid. Positions are logical px (before zoom),
// measured from the canvas's top-left including the headers. Hit tests take
// mouse clientX/clientY plus the canvas's bounding rect.

import type { Cell } from './selection.js'
import type { CanvasRect } from './input/hit-test.js'

export interface Geometry {
	/** Column width; 0 when hidden. */
	cw(c: number): number
	/** Row height; 0 when hidden. */
	rh(r: number): number
	colX(c: number): number
	rowY(r: number): number
	frozenW(): number
	frozenH(): number
	isFilterHidden(r: number): boolean
	firstVisCol(): number
	firstVisRow(): number
	lastVisCol(c0: number, cssW: number): number
	lastVisRow(r0: number, cssH: number): number
	hitTest(ex: number, ey: number, rect: CanvasRect): Cell | null
	clamp(r: number, c: number): Cell
	hitTestColResize(ex: number, ey: number, rect: CanvasRect): number | null
	hitTestColHeader(ex: number, ey: number, rect: CanvasRect): number | null
	hitTestRowHeader(ex: number, ey: number, rect: CanvasRect): number | null
	hitTestCorner(ex: number, ey: number, rect: CanvasRect): boolean
	hitTestRowResize(ex: number, ey: number, rect: CanvasRect): number | null
	colInsertIndex(ex: number, rect: CanvasRect): number
	setColWidth(c: number, w: number): void
	setRowHeight(r: number, h: number): void
}

/** The width/height maps, scroll and freeze are shared and read live. */
export function createGeometry(
	colW: { [col: number]: number },
	rowH: { [row: number]: number },
	scroll: { x: number; y: number },
	freeze?: { rows: number; cols: number },
	hiddenRows?: Set<number> | null,
	hiddenCols?: Set<number> | null,
	getZoom?: () => number,
	filterHiddenRows?: Set<number> | null,
): Geometry
