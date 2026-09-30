import { loadMediaPreferences } from '@/apps/meet/data/mediaPreferences'
import { installConsoleBuffer } from '@/apps/meet/utils/diagnostics/consoleBuffer'

/**
 * Meet's startup work. It runs once, when `routes.ts` first loads with the
 * first Meet route, before any Meet page resolves.
 */
loadMediaPreferences()
installConsoleBuffer()
