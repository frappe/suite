import { SUITE_APPS, isInstallableApp } from '@/apps/registry'
import { readString, writeString } from '@/utils/localStorage'

// Where the installed suite opens. Its manifest cannot name a moving target, so
// its start URL is a shell route that comes here for the app the phone was last
// in. Only the apps with a phone layout are remembered, so a launch always
// lands in one. A notification is not a launch — it opens the URL it carries
// and never passes through here.
const KEY = 'suite:last-app'

// Mail before there is an app to remember: it is what the mail-only PWA opened
// to, and on iOS this is every fresh install, since a home-screen app has its
// own storage and nothing remembered in Safari carries over. The launcher is
// the fallback once its phone layout is ready.
const FALLBACK = '/mail'

export function rememberLastApp(appId: unknown): void {
	if (isInstallableApp(appId)) writeString(KEY, appId as string)
}

/** The prefix to open the suite at: the last remembered app's, or mail's. */
export function lastAppPrefix(): string {
	const app = SUITE_APPS.find((app) => app.id === readString(KEY))
	return app?.pwa ? app.prefix : FALLBACK
}
