// Types for text-wrap.js, so strict TypeScript can import it.

export type WrapMode = 'overflow' | 'clip' | 'wrap'

interface WrapFormat {
	textWrap?: string
	wrapText?: boolean
	fontSize?: number
}

export const WRAP_MODES: readonly WrapMode[]
/** The cell's wrap mode; the legacy `wrapText: true` reads as 'wrap'. */
export function getTextWrap(fmt: WrapFormat | null | undefined): WrapMode
export function isWrapText(fmt: WrapFormat | null | undefined): boolean
/** Logical line height for the cell's font size. */
export function lineHeightFor(fmt: WrapFormat | null | undefined): number
/** The lines a value renders as: hard newlines, then soft wrap to maxW. */
export function wrapLines(val: unknown, maxW: number, measure: (text: string) => number): string[]
