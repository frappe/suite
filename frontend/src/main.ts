import './index.css'

import { createPinia } from 'pinia'
import { createApp, type App as VueApp } from 'vue'

import App from '@/App.vue'
import { clearSlidesUserData } from '@/apps/slides/utils/serviceWorker'
import { initSentry } from '@/boot/sentry'
import { initializeCursor } from '@/platform/cursor'
import { useSession } from '@/platform/session'
import { initializeTheme } from '@/platform/theme'
import { translationPlugin, ready as translationsReady } from '@/platform/translation'
import router from '@/router'

initializeCursor()

const app = createApp(App)

// The Slides service worker keeps this user's responses. Every logout path ends
// in the platform session, so the next user never receives them.
useSession().onLogout(clearSlidesUserData)

await Promise.all([
  initSentry(app, router),
  translationsReady,
  initializeTheme(),
  import('@/boot/config'),
])

app.use(createPinia())
app.use(router)
app.use(translationPlugin)

Promise.all([router.isReady(), installLegacySprite(app)]).then(() => {
  app.mount('#app')
})

async function installLegacySprite(target: VueApp) {
  const { spritePlugin } = await import('frappe-ui/experimental')
  target.use(spritePlugin)
}
