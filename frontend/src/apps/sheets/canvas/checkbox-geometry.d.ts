// Types for checkbox-geometry.js, so strict TypeScript can import it.

export const CHECKBOX: { readonly maxSize: number; readonly minSize: number; readonly margin: number }

/** The tickbox inside a cell of cellW × cellH, as offsets from its top-left. */
export function checkboxRect(cellW: number, cellH: number): { x: number; y: number; size: number }
