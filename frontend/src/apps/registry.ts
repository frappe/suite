/**
 * Single source of truth for the 7 suite apps.
 *
 * Both the router (one lazy route group per app, prefix preserved) and the
 * shell launcher (app switcher) read this list. A per-app port should NOT need
 * to edit this file — it only fills in src/apps/<id>/routes.ts. The id here
 * must match the directory name under src/apps/.
 *
 * Logos are the apps' own brand marks, vendored under src/assets/app-logos/ and
 * imported so Vite fingerprints them into the shared shell bundle.
 */
import calendarLogo from '@/assets/app-logos/calendar.svg'
import driveLogo from '@/assets/app-logos/drive.svg'
import mailLogo from '@/assets/app-logos/mail.svg'
import meetLogo from '@/assets/app-logos/meet.png'
import sheetsLogo from '@/assets/app-logos/sheets.svg'
import slidesLogo from '@/assets/app-logos/slides.svg'
import suiteLogo from '@/assets/app-logos/suite.svg'
import writerLogo from '@/assets/app-logos/writer.png'
import { jmapUser, systemUser } from '@/boot/session'

export interface SuiteApp {
  id: string
  /** Display name shown in the launcher / top-nav. */
  name: string
  /** URL prefix this app owns; preserved from the original standalone app. */
  prefix: string
  /** Imported, build-fingerprinted brand-logo URL. */
  logo: string
}

export interface SuiteAppSwitcherItem {
  name: string
  title: string
  route: string
  logo: string
}

export const SUITE_LOGO = suiteLogo

export const SUITE_APPS: SuiteApp[] = [
  { id: 'drive', name: 'Drive', prefix: '/drive', logo: driveLogo },
  { id: 'slides', name: 'Slides', prefix: '/slides', logo: slidesLogo },
  { id: 'writer', name: 'Writer', prefix: '/writer', logo: writerLogo },
  { id: 'sheets', name: 'Sheets', prefix: '/sheets', logo: sheetsLogo },
  { id: 'meet', name: 'Meet', prefix: '/meet', logo: meetLogo },
  { id: 'mail', name: 'Mail', prefix: '/mail', logo: mailLogo },
  { id: 'calendar', name: 'Calendar', prefix: '/calendar', logo: calendarLogo },
]

export const SUITE_APP_SWITCHER_ITEMS: SuiteAppSwitcherItem[] = SUITE_APPS.map((app) => ({
  name: app.id,
  title: app.name,
  route: app.prefix,
  logo: app.logo,
}))

export const DESK_APP_SWITCHER_ITEM: SuiteAppSwitcherItem = {
  name: 'frappe',
  title: 'Desk',
  route: '/app',
  logo: '/assets/frappe/images/framework.png',
}

export function getAppSwitcherItems(currentApp: string): SuiteAppSwitcherItem[] {
  const items = [
    ...(systemUser.value ? [DESK_APP_SWITCHER_ITEM] : []),
    ...SUITE_APP_SWITCHER_ITEMS.filter((app) => app.name !== currentApp),
  ]
  if (!jmapUser.value) {
    return items.filter((app) => app.name !== 'mail' && app.name !== 'calendar')
  }
  return items
}
