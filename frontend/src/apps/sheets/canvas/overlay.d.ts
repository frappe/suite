// Types for overlay.js, so strict TypeScript can import it.

import type { EditorOverlay } from './input/editor.js'

/** The in-cell editor's <textarea>, added to `parent`. */
export interface Overlay extends EditorOverlay {
	remove(): void
}

export function createOverlay(parent: HTMLElement): Overlay
