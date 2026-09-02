import suiteRouter from '@/router'

/**
 * Re-exports the suite router instance for Drive utilities that read
 * `router.currentRoute` / call `router.push`.
 * Drive's navigation hooks are loaded by the suite from `runtime.ts`.
 */
export const router = suiteRouter
export default suiteRouter
