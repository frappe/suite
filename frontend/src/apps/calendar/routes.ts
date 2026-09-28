import type { RouteRecordRaw } from 'vue-router'

/**
 * Calendar route module — mounted by the suite router under the '/calendar'
 * prefix. Paths are RELATIVE to '/calendar' (no leading slash; the empty-path
 * child '' is the app index). Route names are namespaced `calendar-*` to avoid
 * collisions in the single suite router.
 *
 * The shortcut routes resolve to their full account-scoped equivalents in the
 * calendar guard once the active accountId is known (see ./router.ts). They use
 * a no-op render component since the guard always redirects them.
 *
 * All real routes nest under a layout route (CalendarLayout) which provides the
 * calendar-local `$user` / `$dayjs` injections the views depend on.
 */

const ShortcutRedirect = { render: () => null }

export const routes: RouteRecordRaw[] = [
	{
		path: '',
		component: () => import('@/apps/calendar/pages/CalendarLayout.vue'),
		children: [
			{
				path: 'account/:accountId/month/:year?/:month?/:day?',
				name: 'calendar-month',
				component: () => import('@/apps/calendar/pages/CalendarView.vue'),
			},
			{
				path: 'account/:accountId/week/:year?/:month?/:day?',
				name: 'calendar-week',
				component: () => import('@/apps/calendar/pages/CalendarView.vue'),
			},
			{
				path: 'account/:accountId/day/:year?/:month?/:day?',
				name: 'calendar-day',
				component: () => import('@/apps/calendar/pages/CalendarView.vue'),
			},
			{
				path: 'account/:accountId/agenda/:year?/:month?/:day?',
				name: 'calendar-agenda',
				component: () => import('@/apps/calendar/pages/CalendarView.vue'),
			},
			// Phone-only destination: the tab bar's search tab. A page of its own rather
			// than the palette raised over the calendar, so a result opens where it was
			// found and Back returns to the search. On a desktop search is the palette.
			{
				path: 'account/:accountId/search',
				name: 'calendar-search',
				component: () => import('@/apps/calendar/pages/CalendarView.vue'),
			},
			// Phone-only destination: the tab bar's third tab. On a desktop the same
			// settings are the SettingsDialog the sidebar opens.
			{
				path: 'account/:accountId/profile',
				name: 'calendar-profile',
				component: () => import('@/apps/calendar/pages/ProfileView.vue'),
			},
			// Shortcut routes: short paths that resolve to their full account-scoped
			// equivalents once the active accountId is known (resolved in the guard).
			{
				path: '',
				name: 'calendar-root-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			{
				path: 'account/:accountId?',
				name: 'calendar-account-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			{
				path: 'month/:year?/:month?/:day?',
				name: 'calendar-month-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			{
				path: 'week/:year?/:month?/:day?',
				name: 'calendar-week-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			{
				path: 'day/:year?/:month?/:day?',
				name: 'calendar-day-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			{
				path: 'agenda/:year?/:month?/:day?',
				name: 'calendar-agenda-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			{
				path: 'search',
				name: 'calendar-search-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
		],
	},
]
