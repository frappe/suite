// Types for cells.js, so strict TypeScript can import it. Rows and columns
// are 0-based; ids are A1-style.

/** 0 → 'A', 25 → 'Z', 26 → 'AA'. */
export function colLabel(idx: number): string
/** (0, 0) → 'A1'. */
export function cellId(row: number, col: number): string
/** 'B3' → { row: 2, col: 1 }; null when not a cell id. */
export function parseCellId(id: string): { row: number; col: number } | null
