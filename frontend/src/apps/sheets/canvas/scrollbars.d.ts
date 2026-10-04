// Types for scrollbars.js, so strict TypeScript can import it.

import type { ScrollModel } from './viewport.js'

export interface Scrollbars {
	/** Re-place the thumbs for the current scroll (called after every paint). */
	layout(): void
	destroy(): void
}

/** Overlay scrollbars added to `host`; dragging a thumb calls scrollTo. */
export function createScrollbars(
	host: HTMLElement,
	opts: { getModel(): ScrollModel; scrollTo(x: number, y: number): void },
): Scrollbars
