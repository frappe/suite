import suiteRouter from '@/router'

/**
 * Slides router shim: re-exports the single suite router instance as `router`
 * for slides' module-singleton stores.
 *
 * Access checks are loaded lazily from `runtime.ts`.
 */
export const router = suiteRouter
