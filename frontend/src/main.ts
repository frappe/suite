import './index.css'

import { createPinia } from 'pinia'
import { createApp, type App as VueApp } from 'vue'

import App from '@/App.vue'
import { installEventReminders } from '@/apps/calendar'
import { installMailReminders } from '@/apps/mail'
import { clearSlidesUserData } from '@/apps/slides/utils/serviceWorker'
import { initSentry } from '@/boot/sentry'
import { documentTypes } from '@/composition/documentRegistry'
import { watchBuild } from '@/platform/build'
import { DOCUMENT_TYPES_KEY } from '@/platform/contracts'
import { initializeCursor } from '@/platform/cursor'
import { installErrorLog } from '@/platform/error-log'
import { installApiErrorHandler } from '@/platform/server-state'
import { useSession } from '@/platform/session'
import { initializeTheme } from '@/platform/theme'
import { installUserTimeZone } from '@/platform/time-zone'
import { translationPlugin, ready as translationsReady } from '@/platform/translation'
import router, { preloadPage } from '@/router'

initializeCursor()
installUserTimeZone()
watchBuild()
installEventReminders({ open: (path) => void router.push(path) })
installMailReminders({ open: (path) => void router.push(path) })

const app = createApp(App)
app.use(translationPlugin)
// Dialogs opened by function call render in the app's context, so this reaches them too.
app.provide(DOCUMENT_TYPES_KEY, documentTypes)

// The Slides service worker keeps this user's responses. Every logout path ends
// in the platform session, so the next user never receives them.
useSession().onLogout(clearSlidesUserData)

void import('@/shell/ShellLayout.vue')
// Some pages call `__` as their module evaluates, so their code waits for the catalog.
void translationsReady.then(() => preloadPage(window.location.pathname))

// The page arrives in the user's saved theme, so the preference read need not hold the mount.
void initializeTheme()
await Promise.all([initSentry(app, router), translationsReady, import('@/boot/config')])

installErrorLog(app)
installApiErrorHandler(app)

app.use(createPinia())
app.use(router)

// A first navigation that fails still mounts the app: the router has sent it
// on to the page that says so (`@/platform/load-failure`).
Promise.all([router.isReady().catch(() => {}), installLegacySprite(app)]).then(() => {
  app.mount('#app')
})

async function installLegacySprite(target: VueApp) {
  const { spritePlugin } = await import('frappe-ui/experimental')
  target.use(spritePlugin)
}
