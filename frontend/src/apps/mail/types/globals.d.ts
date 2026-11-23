export {}

// The global `__` translate helper is provided by the suite foundation
// (src/env.d.ts + the global translation plugin), so it is NOT re-declared
// here to avoid a conflicting duplicate declaration.

declare global {
  interface Window {}
}
