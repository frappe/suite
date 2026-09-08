import suiteRouter from '@/router'

/**
 * Writer router shim. Writer has no app-specific navigation guard (auth is the
 * suite router's `beforeEach`; `writer-document` carries `meta.allowGuest`),
 * so this module only re-exports the single suite router instance for writer
 * utils that read `router.currentRoute`.
 */
export default suiteRouter
