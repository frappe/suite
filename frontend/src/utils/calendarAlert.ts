import { h } from 'vue'
import { toast } from 'frappe-ui'

import router from '@/router'

/**
 * A triggered event alert, as the server publishes it over the socket
 * (`calendar_alert`): the same title and line the device push carries, and
 * the in-app path to the event. Reaches an open tab in any suite app,
 * whether or not device push is set up.
 */
export const showCalendarAlert = (alert: { title: string; body: string; path: string }) => {
	// Both surfaces, deliberately: the toast is the in-app affordance with an
	// Open action, the system notification is the one the OS manages — Do Not
	// Disturb, stacking, and (via the tag) deduping across open tabs.
	toast.message(alert.title, {
		icon: () => h('span', { class: 'lucide-bell size-4' }),
		description: alert.body,
		duration: 15_000,
		action: { label: __('Open'), onClick: () => router.push(alert.path) },
	})
	if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
		const notification = new Notification(alert.title, {
			body: alert.body,
			tag: alert.path,
			icon: '/assets/suite/calendar/images/logo.png',
		})
		notification.onclick = () => {
			window.focus()
			router.push(alert.path)
			notification.close()
		}
	}
}

/**
 * Asks once for system notifications, the first time the user sets a
 * reminder — the moment they have just said they want to be told.
 */
export const requestAlertPermission = () => {
	if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
	Notification.requestPermission()
}
