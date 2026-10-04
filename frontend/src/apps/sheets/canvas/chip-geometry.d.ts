// Types for chip-geometry.js, so strict TypeScript can import it.

interface ChipFormat {
	bold?: boolean
	italic?: boolean
	fontSize?: number
	fontFamily?: string
	align?: string
}

interface ChipRule {
	colors?: { readonly [value: string]: string }
	options?: readonly string[]
}

export const CHIP: {
	readonly padX: number
	readonly innerPad: number
	readonly caretW: number
	readonly maxH: number
	readonly minH: number
}

export function chipPaletteColor(i: number): string
/** Canvas font string for a cell format, as the cell painter draws it. */
export function chipFont(fmt?: ChipFormat): string
export function chipColor(value: unknown, rule?: ChipRule | null): string
export function chipMetrics(
	ctx: CanvasRenderingContext2D,
	text: string,
	fmt: ChipFormat | null | undefined,
	cellW: number,
): { offsetX: number; chipW: number }
