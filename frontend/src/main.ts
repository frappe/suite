import './index.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { spritePlugin } from 'frappe-ui/icons'
import { pageMetaPlugin } from 'frappe-ui'

import App from '@/App.vue'
import router from '@/router'
import { configureFrappeUI } from '@/boot/config'
import { translationPlugin } from '@/boot/translation'
import { userResource, getSessionUser } from '@/boot/session'

// One frappe-ui resource/session configuration for the whole suite.
configureFrappeUI()
if (getSessionUser()) {
  userResource.fetch()
}

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(pageMetaPlugin)
app.use(spritePlugin)
app.use(translationPlugin)

router.isReady().then(() => {
  app.mount('#app')
})
