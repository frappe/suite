import suiteRouter from '@/router'
export {
  editorAccess,
  previousRoute,
  setEditorAccess,
  setPreviousRoute,
} from './routerState'

/**
 * Slides router shim: re-exports the single suite router instance as `router`
 * for slides' module-singleton stores, and tracks the `previousRoute` +
 * per-presentation `editorAccess` that slides' views read.
 *
 * Navigation tracking and access checks are loaded lazily from `runtime.ts`.
 */
export const router = suiteRouter
