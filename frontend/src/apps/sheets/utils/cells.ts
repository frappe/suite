// A1-style cell ids. Rows and columns are 0-based.

/** 0 → 'A', 25 → 'Z', 26 → 'AA'. */
export function colLabel(idx: number): string {
  let s = ''
  idx++
  while (idx > 0) {
    s = String.fromCharCode(64 + (idx % 26 || 26)) + s
    idx = Math.floor((idx - 1) / 26)
  }
  return s
}

/** (0, 0) → 'A1'. */
export function cellId(row: number, col: number): string {
  return colLabel(col) + (row + 1)
}

/** 'B3' → { row: 2, col: 1 }; null when not a cell id. */
export function parseCellId(id: string): { row: number; col: number } | null {
  const m = id.match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  const [, letters = '', digits = ''] = m
  return {
    row: parseInt(digits) - 1,
    col: letters.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1,
  }
}
