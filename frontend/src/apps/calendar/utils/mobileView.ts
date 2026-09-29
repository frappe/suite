import { Columns3, Grid3x3, Rows3, SquareSquare } from 'lucide-vue-next'

import dayjs from '@/apps/calendar/utils/dayjs'

import type { Component } from 'vue'
import type { CalendarMode } from 'frappe-ui/experimental'

/**
 * The four views the calendar has — one day at a time, the week, the month, and
 * an agenda, which is the phone's home.
 *
 * Named in one place because every surface has to agree on them: the switcher
 * sheet that lists them, the tab bar that names the one you are on, the view
 * itself, the library's own name for it, and the route each is written to.
 * Mail does the same with its folders.
 */
export type MobileView = 'agenda' | 'day' | 'week' | 'month'

/**
 * In the order the desktop's own switcher lists them — day, week, month, agenda
 * — so a view sits in the same place on either device. Home leading was a second
 * ordering to learn for the same four words.
 *
 * The icons are the ones the desktop's switcher marks the same views with — a
 * day's own frame, a set of columns, a grid of days, a stack of rows — so a view
 * is the same thing to look for on either device. The URL is the source of truth
 * for which view is up — switching is a navigation, so Back retraces it — which
 * means every surface that reads or writes the view goes through this table
 * rather than testing route names of its own.
 */
const VIEWS: Record<
	MobileView,
	{ mode: CalendarMode; route: string; icon: Component; label: () => string }
> = {
	day: { mode: 'Day', route: 'calendar-day', icon: SquareSquare, label: () => __('Day') },
	week: { mode: 'Week', route: 'calendar-week', icon: Columns3, label: () => __('Week') },
	month: { mode: 'Month', route: 'calendar-month', icon: Grid3x3, label: () => __('Month') },
	agenda: { mode: 'Agenda', route: 'calendar-agenda', icon: Rows3, label: () => __('Agenda') },
}

export const MOBILE_VIEWS = Object.keys(VIEWS) as MobileView[]

export const viewIcon = (view: MobileView) => VIEWS[view].icon
export const viewLabel = (view: MobileView) => VIEWS[view].label()

export const routeForView = (view: MobileView) => VIEWS[view].route
export const modeForView = (view: MobileView) => VIEWS[view].mode

/** The view a route name draws on a phone; anything else is home. */
export const viewForRoute = (name: unknown): MobileView =>
	MOBILE_VIEWS.find((view) => VIEWS[view].route === name) ?? 'agenda'

/** The view the library calls `mode`, if it is one the calendar draws. */
export const viewForMode = (mode: unknown) => MOBILE_VIEWS.find((view) => VIEWS[view].mode === mode)

export const routeForMode = (mode: CalendarMode) => routeForView(viewForMode(mode)!)

/** The library's name for the view a route draws, or nothing for a route that is not a view. */
export const modeForRoute = (name: unknown) => {
	const view = MOBILE_VIEWS.find((view) => VIEWS[view].route === name)
	return view && VIEWS[view].mode
}

/** Every route that is a view, on either device. */
export const VIEW_ROUTES = MOBILE_VIEWS.map((view) => VIEWS[view].route)

/**
 * Whether a route name is one of the views, as opposed to the calendar's other pages —
 * profile, search, the shortcut records the guard expands. The phone writes its date and
 * view into the URL as it moves, and only a view route is somewhere that belongs.
 */
export const isViewRoute = (name: unknown): name is string =>
	typeof name === 'string' && VIEW_ROUTES.includes(name)

/** The day a route names, or today when it names none — the way the views write it. */
export const routeDate = (params: { year?: unknown; month?: unknown; day?: unknown }) => {
	const { year, month, day } = params
	const date = year && month && day ? dayjs(`${year}-${month}-${day}`, 'YYYY-M-D') : dayjs()
	return date.isValid() ? date : dayjs()
}
