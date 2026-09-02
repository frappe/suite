import { loadMediaPreferences } from '@/apps/meet/data/mediaPreferences'
import { installConsoleBuffer } from '@/apps/meet/utils/diagnostics/consoleBuffer'
import { meetGuard } from '@/apps/meet/router'

export function bootstrap() {
  loadMediaPreferences()
  installConsoleBuffer()
}

export const beforeEach = meetGuard
