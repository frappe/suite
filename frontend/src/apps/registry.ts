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

interface SuiteApp {
  id: string
  /** Display name shown in the launcher / top-nav. */
  name: string
  /** URL prefix this app owns. */
  prefix: string
  /** Imported, build-fingerprinted brand-logo URL. */
  logo: string
  /**
   * Has a phone layout, so the suite PWA offers to install from inside it.
   * The install is one app, Frappe Suite; this only says where the offer
   * appears. Set it as each app gets its phone layout.
   */
  pwa?: boolean
}

export interface SuiteAppSwitcherItem {
  name: string
  title: string
  route: string
  logo: string
  spa: boolean
}

export const SUITE_LOGO = suiteLogo

export const SUITE_APPS: SuiteApp[] = [
  { id: 'drive', name: 'Drive', prefix: '/drive', logo: driveLogo },
  { id: 'slides', name: 'Slides', prefix: '/slides', logo: slidesLogo },
  { id: 'writer', name: 'Writer', prefix: '/writer', logo: writerLogo },
  { id: 'sheets', name: 'Sheets', prefix: '/sheets', logo: sheetsLogo },
  { id: 'meet', name: 'Meet', prefix: '/meet', logo: meetLogo },
  { id: 'mail', name: 'Mail', prefix: '/mail', logo: mailLogo, pwa: true },
  { id: 'calendar', name: 'Calendar', prefix: '/calendar', logo: calendarLogo, pwa: true },
]

/** Whether the suite PWA's manifest and install offer belong on this app's routes. */
export function isInstallableApp(appId: unknown): boolean {
  return !!SUITE_APPS.find((app) => app.id === appId)?.pwa
}

const SUITE_APP_SWITCHER_ITEMS: SuiteAppSwitcherItem[] = SUITE_APPS.map((app) => ({
  name: app.id,
  title: app.name,
  route: app.prefix,
  logo: app.logo,
  spa: true,
}))

const DESK_APP_SWITCHER_ITEM: SuiteAppSwitcherItem = {
  name: 'frappe',
  title: 'Desk',
  route: '/app',
  logo: '/assets/frappe/images/framework.png',
  spa: false,
}

/**
 * The phone's switcher: the app you are in first, then the other apps with a phone
 * layout (`pwa`) that the desktop menu would offer you. Desk has none, so it is left out.
 */
export function getPhoneAppSwitcherItems(currentApp: string): SuiteAppSwitcherItem[] {
  const current = SUITE_APP_SWITCHER_ITEMS.find((app) => app.name === currentApp)
  const others = getAppSwitcherItems(currentApp).filter((app) => isInstallableApp(app.name))
  return [...(current ? [current] : []), ...others]
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
