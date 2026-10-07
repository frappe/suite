// Limits shared by the worker and the main thread. Kept apart from
// worker.ts so main-thread code can import them without pulling in the
// engine.

// Upper bound for one readViewport. A screen plus overscan is a few
// thousand cells; anything near this limit is a caller bug, and the
// per-cell loop would stall the worker.
export const MAX_VIEWPORT_CELLS = 100_000
