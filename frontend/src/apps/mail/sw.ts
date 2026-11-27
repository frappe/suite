import { initializeApp } from 'firebase/app'
import { getMessaging } from 'firebase/messaging/sw'

import {
  isSuitePushNotification,
  openNotificationTarget,
  pushNotification,
  suitePush,
  type PushPayload,
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

// A Suite push is shown here, always, and the push event waits for it. Safari ends a device's
// push subscription after a few pushes that show nothing, so neither Firebase's habit of handing
// a push to a visible page instead, nor a notification shown after the event ends, may happen.
// Registered before Firebase starts, so Firebase never sees these pushes.
self.addEventListener('push', (event: PushEvent) => {
  const payload = suitePushIn(event)
  if (!payload) return
  event.stopImmediatePropagation()
  event.waitUntil(self.registration.showNotification(...pushNotification(payload)))
})

function suitePushIn(event: PushEvent): PushPayload | null {
  try {
    return suitePush(event.data?.json())
  } catch {
    return null
  }
}

// Firebase still keeps this device's push subscription and token current.
try {
  getMessaging(initializeApp(JSON.parse(jsonConfig ?? 'null')))
} catch (error) {
  console.log('Failed to initialize Firebase:', error)
}

self.skipWaiting()
self.clients.claim()
console.log('Service Worker Initialized')
