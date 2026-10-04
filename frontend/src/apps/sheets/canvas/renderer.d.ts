// Types for renderer.js, so strict TypeScript can import it.

import type { Geometry } from './geometry.js'
import type { Cell, SelMode } from './selection.js'
import type { CellFormat, CellValue, MergeInfo } from './types.js'
import type { ColDrag } from './input/mouse.js'
import type { AntsRect } from './marching-ants.js'
import type { PickRect } from './input/range-picker.js'

/** Everything one paint needs; the painters read the callbacks per cell. */
export interface RenderOptions {
	cssW: number
	cssH: number
	getValue(id: string): CellValue
	sel: Cell
	selEnd: Cell
	selMode?: SelMode
	editing: boolean
	getFormat?: ((id: string) => CellFormat | null | undefined) | undefined
	freeze?: { rows: number; cols: number }
	getMergeInfo?: ((id: string) => MergeInfo | null | undefined) | undefined
	isSlave?: ((id: string) => boolean) | undefined
	getComment?: ((id: string) => unknown) | null | undefined
	getValidation?: ((id: string) => unknown) | null | undefined
	getCondFormat?: ((id: string) => unknown) | null | undefined
	getSparkline?: ((id: string) => unknown) | null | undefined
	getRightInset?: ((id: string) => number) | null | undefined
	getDiffFor?: ((id: string) => boolean) | null
	marchAnts?: AntsRect | null
	marchPhase?: number
	pickerRect?: PickRect | null
	colDrag?: ColDrag | null
	zoom?: number
}

export interface Renderer {
	render(opts: RenderOptions): void
}

export function createRenderer(ctx: CanvasRenderingContext2D, geometry: Geometry): Renderer
