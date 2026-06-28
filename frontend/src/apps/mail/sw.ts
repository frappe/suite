import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'

// Firebase Cloud Messaging service worker. Bundled to `sw.js` by vite-plugin-pwa
// (injectManifest) and emitted at /assets/suite/frontend/sw.js, where
// MailLayout.registerServiceWorker() registers it with `?config=<fcm-web-config>`.
//
// Ported from the standalone mail app's public/sw.ts. The workbox precaching
// (precacheAndRoute(self.__WB_MANIFEST) / cleanupOutdatedCaches) was intentionally
// dropped: the suite is a shared 7-app SPA and we only want FCM background
// notifications here, not to turn the whole suite into a precaching PWA.

declare const self: ServiceWorkerGlobalScope

const jsonConfig = new URL(location.href).searchParams.get('config')

// Firebase config initialization
try {
	const firebaseApp = initializeApp(JSON.parse(jsonConfig as string))
	const messaging = getMessaging(firebaseApp)

	const isChrome = () => navigator.userAgent.toLowerCase().includes('chrome')

	onBackgroundMessage(messaging, (payload: import('firebase/messaging').MessagePayload) => {
		const notificationTitle = payload.data?.title ?? ''
		const notificationOptions: NotificationOptions = { body: payload.data?.body || '' }
		if (payload.data?.notification_icon)
			notificationOptions.icon = payload.data.notification_icon

		if (isChrome()) notificationOptions.data = { url: payload.data?.click_action }
		else if (payload.data?.click_action)
			notificationOptions.actions = [
				{ action: payload.data.click_action, title: 'View Details' },
			]

		self.registration.showNotification(notificationTitle, notificationOptions)
	})

	if (isChrome()) {
		self.addEventListener('notificationclick', (event: NotificationEvent) => {
			event.stopImmediatePropagation()
			event.notification.close()
			if (event.notification.data && (event.notification.data as { url?: string }).url)
				clients.openWindow((event.notification.data as { url: string }).url)
		})
	}
} catch (error) {
	console.log('Failed to initialize Firebase:', error)
}

self.skipWaiting()
self.clients.claim()
console.log('Service Worker Initialized')
