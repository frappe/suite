/** Composition assembles only lightweight references; product policies load on first use. */
import { watch } from 'vue'

import { api as calendar } from '@/apps/calendar/client/api'
import { api as draw } from '@/apps/draw/client/api'
import { api as drive } from '@/apps/drive/client/api'
import { api as mail } from '@/apps/mail/client/api'
import { api as meet } from '@/apps/meet/client/api'
import { api as sheets } from '@/apps/sheets/client/api'
import { api as slides } from '@/apps/slides/client/api'
import { api as writer } from '@/apps/writer/client/api'
import { subscribeDriveChanges } from '@/composition/driveChanges'
import { realtime } from '@/platform/realtime'
import { createApiClient } from '@/platform/server-state'
import { registerAccountReader, useSession } from '@/platform/session'
import { registerThemePreferences } from '@/platform/theme'
import { api as suite } from '@/platform/transport/api'

export const api = { suite, drive, draw, mail, meet, calendar, writer, sheets, slides } as const
export const engine = createApiClient(
  {
    draw: () => import('@/apps/draw/client/policy').then((module) => module.registration),
    writer: () => import('@/apps/writer/client/policy').then((module) => module.registration),
    sheets: () => import('@/apps/sheets/client/policy').then((module) => module.registration),
    slides: () => import('@/apps/slides/client/policy').then((module) => module.registration),
    suite: () => import('@/platform/transport/policy').then((module) => module.registration),
    drive: () => import('@/apps/drive/client/policy').then((module) => module.registration),
    mail: () => import('@/apps/mail/client/policy').then((module) => module.registration),
    meet: () => import('@/apps/meet/client/policy').then((module) => module.registration),
    calendar: () => import('@/apps/calendar/client/policy').then((module) => module.registration),
  },
  {
    realtime: import.meta.env.MODE === 'test' ? false : realtime,
  },
)

if (import.meta.env.MODE !== 'test') subscribeDriveChanges(realtime, engine.invalidate)

const session = useSession()
watch(
  () => session.user.value?.id ?? null,
  () => engine.resetIdentity(),
  { flush: 'sync' },
)
session.onLogout(() => engine.resetIdentity())

registerAccountReader(() => engine.client.query(api.suite.account.get))

registerThemePreferences({
  read: () => engine.client.query(api.suite.preferences.get),
  save: (theme) =>
    engine.client.mutation(api.suite.preferences.setTheme, { theme }, { silent: true }),
})
