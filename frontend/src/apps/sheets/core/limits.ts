// Limits shared by the worker and the main thread. Kept apart from
// worker.ts so main-thread code can import them without pulling in the
// engine.

// Upper bound for one readViewport. A screen plus overscan is a few
// thousand cells; anything near this limit is a caller bug, and the
// per-cell loop would stall the worker.
export const MAX_VIEWPORT_CELLS = 100_000

// Cells the display cache keeps before it drops entries off screen. Below
// it, a sheet you leave keeps its last values, so switching back paints
// them at once instead of blank.
export const MAX_CACHED_CELLS = 200_000

// Rows in a sheet (Excel's limit, which IronCalc uses).
export const MAX_ROWS = 1_048_576

// Upper bound for one findCells: more matches than anyone steps through.
export const MAX_FIND_RESULTS = 10_000
