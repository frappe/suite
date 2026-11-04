import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'

import {
  isSuitePushNotification,
  openNotificationTarget,
  pushNotification,
} from '@/platform/pwa/notification'

// Firebase Cloud Messaging service worker. Bundled to `sw.js` by vite-plugin-pwa
// (injectManifest) and emitted at /assets/suite/frontend/sw.js, where the platform
// (src/platform/pwa) registers it after sign-in with `?config=<fcm-web-config>`.
//
// No workbox precaching on purpose: the suite is a shared 7-app SPA and we
// only want FCM background notifications here, not a precaching PWA.

declare const self: ServiceWorkerGlobalScope

const jsonConfig = new URL(location.href).searchParams.get('config')

// A click on a Suite push notification opens its target, in every browser. Registered before
// Firebase starts, so it runs first and keeps Firebase's click handler off these notifications.
// A notification Firebase drew itself carries no `url` and stays with Firebase.
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  if (!isSuitePushNotification(event.notification.data)) return
  event.stopImmediatePropagation()
  event.notification.close()
  event.waitUntil(
    openNotificationTarget(self.clients, self.location.origin, event.notification.data),
  )
})

// Firebase config initialization
try {
  const firebaseApp = initializeApp(JSON.parse(jsonConfig as string))
  const messaging = getMessaging(firebaseApp)

  onBackgroundMessage(messaging, (payload: import('firebase/messaging').MessagePayload) => {
    self.registration.showNotification(...pushNotification(payload))
  })
} catch (error) {
  console.log('Failed to initialize Firebase:', error)
}

self.skipWaiting()
self.clients.claim()
console.log('Service Worker Initialized')
