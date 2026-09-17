<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onScopeDispose, reactive, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNow } from '@vueuse/core'
import { Button, Dialog, TabButtons, createResource, useKeyboardShortcut, usePageMeta } from 'frappe-ui'
import { Calendar, CalendarActiveEvent, calendarDaySpan } from 'frappe-ui/experimental'

import { useScreenSize } from '@/composables/useScreenSize'
import { appPageMeta } from '@/utils/documentTitle'
import { raiseToast } from '@/apps/calendar/utils'
import { fromEventZone, shiftedMasterStart } from '@/apps/calendar/utils/datetime'
import { eventLastDay, isAllDayEvent } from '@/apps/calendar/utils/eventTime'
import { reanchoredRule } from '@/apps/calendar/utils/recurrence'
import { isFirstOccurrence, scopeOptions } from '@/apps/calendar/utils/recurringScope'
import type { RecurringScope } from '@/apps/calendar/utils/recurringScope'
import { eventPeople, eventPlace, eventRowDescription } from '@/apps/calendar/utils/eventMeta'
import { weekSpanLabel } from '@/apps/calendar/utils/format'
import { userStore } from '@/apps/calendar/stores/user'
import { useRootStore } from '@/stores/root'
import { invalidateEventDensity } from '@/apps/calendar/composables/useEventDensity'
import { rememberCalendarView } from '@/apps/calendar/utils/lastView'
import AppSidebar from '@/apps/calendar/components/AppSidebar.vue'
import EventDetail from '@/apps/calendar/components/EventDetail.vue'
import EventPopover from '@/apps/calendar/components/EventPopover.vue'
import EventModal from '@/apps/calendar/components/Modals/EventModal.vue'
import RecurringScopeModal from '@/apps/calendar/components/Modals/RecurringScopeModal.vue'
import EventDetailSheet from '@/apps/calendar/components/mobile/EventDetailSheet.vue'
import MobileCalendar from '@/apps/calendar/components/mobile/MobileCalendar.vue'
import {
	modeForRoute,
	routeDate,
	routeForMode,
	routeForView,
	viewForRoute,
} from '@/apps/calendar/utils/mobileView'

import type { MobileView } from '@/apps/calendar/utils/mobileView'

const dayjs = inject('$dayjs')

const store = userStore()
const { participantIdentities } = store
const { isMobile } = useScreenSize()

const route = useRoute()
const router = useRouter()

const calendarRef = useTemplateRef('calendar')

/* -------------------------------------------------------------------------- */
/* The phone shell                                                            */
/*                                                                            */
/* The desktop grid and the phone's agenda are two trees over one set of      */
/* events, not one tree restyled — `useScreenSize` decides which mounts, and  */
/* only one of them ever exists. So the state the fui Calendar holds for the  */
/* desktop (which day, which view) is held here for the phone, and everything */
/* downstream — the fetch window, the route, the page title — reads whichever */
/* of the two is live.                                                        */
/* -------------------------------------------------------------------------- */

/** The day the phone is on. The desktop's equivalent lives inside the Calendar. */
const mobileDate = ref(routeDate(route.params).format('YYYY-MM-DD'))
const mobileView = ref<MobileView>(viewForRoute(route.name))

// Drives the now-line and the "Today" affordance. Half a minute is as often as
// a clock reading h:mm can say anything new.
const now = useNow({ interval: 30_000 })

// The month whose events are fetched: the calendar's on desktop, the selected
// day's on the phone. Without this the phone asked for `dayjs().year(undefined)`
// — the Calendar that answers those questions is not mounted there.
const anchorMonth = computed(() => {
	if (isMobile.value) return dayjs(mobileDate.value)
	return dayjs().year(calendarRef.value?.currentYear).month(calendarRef.value?.currentMonth)
})

const pageTitle = computed(() => {
	if (isMobile.value) return dayjs(mobileDate.value).format('MMMM YYYY')
	return calendarRef.value?.currentMonthYear || __('Frappe Calendar')
})

usePageMeta(() => appPageMeta(pageTitle.value, 'Calendar'))

// The phone writes its day into the route the way the desktop calendar does, so
// a deep link opens on it and Back walks the days visited. The view rides along,
// each on the route it is named after.
watch([mobileDate, mobileView], ([date, view], [previousDate]) => {
	if (!isMobile.value) return

	const day = dayjs(date)
	const name = routeForView(view)
	const params = {
		accountId: store.accountId,
		year: String(day.year()),
		month: String(day.month() + 1),
		day: String(day.date()),
	}
	if (route.name !== name || route.params.day !== params.day || route.params.month !== params.month)
		router.replace({ name, params, query: route.query })

	// A new month is outside the window that was fetched for the old one.
	if (previousDate && !day.isSame(dayjs(previousDate), 'month')) events.reload()
})

// Back/Forward and the account switch write the route; the phone follows it,
// the way applyRoute has the desktop calendar follow it.
// One string rather than a rebuilt array, for the reason applyRoute's watcher
// below gives: an array getter fires on every route change, this one included.
watch(
	() => `${String(route.name)}|${route.params.year}|${route.params.month}|${route.params.day}`,
	() => {
		if (!isMobile.value) return
		const date = routeDate(route.params).format('YYYY-MM-DD')
		if (date !== mobileDate.value) mobileDate.value = date
		mobileView.value = viewForRoute(route.name)
	},
)

watch(
	() => [
		calendarRef.value?.currentYear,
		calendarRef.value?.currentMonth,
		calendarRef.value?.currentDay,
	],
	([year, month]) => {
		// Nothing to write while the calendar is not mounted (a hot reload unmounts it).
		if (year == null || month == null) return
		// Refetching is the range watcher's job — a month change reports a new range
		// too, and reloading here as well fetched the same window twice.
		setRoute()
	},
)

watch(
	() => calendarRef.value?.activeView,
	(view) => {
		if (view && routeForMode(view) !== route.name) setRoute()
	},
)

watch(
	() => store.accountId,
	() => {
		calendars.reload()
		reloadEvents()
	},
)

const setRoute = () => {
	const year = calendarRef.value?.currentYear
	const month = calendarRef.value?.currentMonth
	const day = calendarRef.value?.currentDay

	const target = dayjs().year(year).month(month).date(day)
	const view = calendarRef.value?.activeView as 'Month' | 'Week' | 'Day' | 'Agenda'
	const name = routeForMode(view)
	const accountId = route.params.accountId

	// The other three view names double as dayjs units; Agenda does not, and an
	// unknown unit quietly turns isSame into a millisecond comparison — never
	// true, so today's agenda would refuse the bare URL and every step would
	// push a history entry instead of replacing one. It lists a month, so that
	// is the unit it is compared by.
	const unit = view === 'Agenda' ? 'month' : view

	// Today's period gets the bare URL. Query carries the open event's deep
	// link; date/view navigation keeps it.
	const location = dayjs().isSame(target, unit)
		? { name, params: { accountId }, query: route.query }
		: { name, params: { accountId, year, month: month + 1, day }, query: route.query }

	// Every change of view or period is a history entry, so Back retraces it.
	// The one exception is when the URL already shows this view and period —
	// e.g. a dated URL for today's month collapsing to the bare one — which
	// only re-forms the current entry rather than adding a copy of it.
	const { year: y, month: m, day: d } = route.params
	const current = y && m && d ? dayjs(`${y}-${m}-${d}`, 'YYYY-M-D') : dayjs()
	if (modeForRoute(route.name) === view && current.isSame(target, unit)) router.replace(location)
	else router.push(location)
}

// The URL is the source of truth for view and date. All three view routes
// render this one component, so Back/Forward change the route without a
// remount — the calendar has to be told each time, not just on mount. Only
// what differs is written, which is what keeps this and setRoute (which
// writes the route from the calendar) from chasing each other.
const applyRoute = () => {
	const calendar = calendarRef.value
	if (!calendar) return

	const view = modeForRoute(route.name)
	if (view && calendar.activeView !== view) calendar.activeView = view

	// A route without a date is today's, the way setRoute writes it.
	const { year, month, day } = route.params
	const date = year && month && day ? dayjs(`${year}-${month}-${day}`, 'YYYY-M-D') : dayjs()
	if (!date.isValid()) return
	if (
		date.year() !== calendar.currentYear ||
		date.month() !== calendar.currentMonth ||
		date.date() !== calendar.currentDay
	)
		calendar.setCalendarDate(date)
}

onMounted(() => {
	applyRoute()
	// The desktop's first fetch is a side effect of the fui Calendar mounting and
	// announcing its month; the phone has no such component, so it asks itself.
	if (isMobile.value) events.fetch()
	openNewEventFromRoute(route.query.new)
})

// Watched as one string, not as an array the getter rebuilds: a getter returning
// a fresh array is a new value to Vue every time it runs, and it runs on any
// change to the route — so opening an event, which only writes `?event=`, read
// as a change of date. applyRoute then found the calendar's `currentDay` (1,
// which was the Month view's answer at the time) against today's date, decided
// they differed, and sent the calendar to today — which scrolled the agenda
// back there from wherever the reader had got to.
watch(
	() => `${String(route.name)}|${route.params.year}|${route.params.month}|${route.params.day}`,
	() => applyRoute(),
)

// Whichever way the view was reached — the switcher, a deep link, Back — the
// route is what says which one it is, so remembering it here covers all three
// rather than only the button. Immediate: arriving on a view is leaving the
// calendar in it, and a reader who opens Week and closes the tab meant Week.
watch(() => route.name, rememberCalendarView, { immediate: true })

const transformEvent = (event) => {
	// All-day-ness is the event's own flag, or the midnight-to-midnight shape of an invite
	// that arrived without one; either way it is read off the stored wall clock.
	const isAllDay = isAllDayEvent(event)

	// Timed events are placed in the viewer's zone; all-day events keep their calendar date.
	const start = isAllDay ? dayjs(event.start) : fromEventZone(event.start, event.time_zone)
	const end = start.add(dayjs.duration(event.duration || 'PT0S'))
	// The calendar reads `toDate` inclusively, so an all-day event hands over its last day
	// rather than the midnight after it that the stored end points at.
	const lastDay = isAllDay ? (eventLastDay(start, event.duration, true) ?? start) : end

	return {
		...event,
		// The calendar pills render `title` verbatim (frappe-ui hardcodes an italic
		// '[No title]' fallback), so untitled events get their placeholder here.
		// actualTitle keeps the raw value; every path that writes back to the
		// server must restore it (withActualTitle) or the placeholder gets saved.
		title: event.title || __('Untitled event'),
		actualTitle: event.title,
		fromDate: start.format('YYYY-MM-DD'),
		toDate: lastDay.format('YYYY-MM-DD'),
		fromTime: start.format('HH:mm'),
		toTime: end.format('HH:mm'),
		role: getEventRole(event),
		isAllDay,
		isFullDay: isAllDay,
		// The server's `draft` (JMAP isDraft): saved, but nothing sent. The pill draws it
		// as an outline.
		isDraft: !!event.draft,
		// frappe-ui's own generic fields, which its event popover and the default
		// row description read. Suite keeps the arrays these come from, so without
		// this the library has nothing to say about where an event is or who is in
		// it — and the popover's venue and participant lines never appear.
		venue: eventPlace(event),
		participant: eventPeople(event),
		// The viewer declined: struck through in the grid.
		isDeclined: !!event.participants?.some(
			(p) => p.participation_status === 'DECLINED' && isOwnEmail(p.email),
		),
	}
}

const isOwnEmail = (email: string) =>
	!!participantIdentities.data?.some((id) => id.email === email?.replace('mailto:', ''))

const getEventRole = (event) => {
	if (participantIdentities.data?.some((id) => id.email === event.organizer.replace('mailto:', '')))
		return 'Organizer'
	if (
		participantIdentities.data?.some((id) =>
			event.participants?.some((p) => p.email.replace('mailto:', '') === id.email),
		)
	)
		return 'Attendee'
	return 'Viewer'
}

const calendars = createResource({
	url: 'suite.calendar.api.get_calendars',
	makeParams: () => ({ account: store.accountId }),
	auto: true,
	onSuccess: (data) => (visibleCalendars.value = data.map((cal) => cal.name)),
	onError: (error) => raiseToast(error.message, 'error'),
})

const visibleCalendars = ref<string[]>([])

// A calendar's colour is its own — set wherever its owner set it, and sent with
// the calendar. Only where it has none does one come from the palette by
// position, which is what every calendar used to get; its events and its dot in
// the sidebar share whichever it is.
const PALETTE = ['green', 'blue', 'violet', 'amber', 'pink', 'cyan', 'orange']
const calendarColor = (name: string) => {
	const index = calendars.data?.findIndex((cal) => cal.name === name) ?? -1
	return calendars.data?.[index]?.color || PALETTE[Math.max(index, 0) % PALETTE.length]
}
const coloredCalendars = computed(
	() => calendars.data?.map((cal) => ({ ...cal, color: calendarColor(cal.name) })) || [],
)

// The period the calendar is showing, as it reports it on every change of view or
// date. Declared above the resource that reads it: makeParams runs late enough
// either way, but a fetch moving earlier would find it in its dead zone.
const visibleRange = ref<{ view: string; startDate: string; endDate: string } | null>(null)

// The Agenda's span, and so the forward reach every fetch has to cover.
const AGENDA_MONTHS = 3

// What the last fetch covered, so a range change only asks again when it wants
// something outside it.
let fetchedRange: { from: string; to: string } | null = null

/**
 * The window for a given anchor month: wide enough for every view of it — the
 * Month strip's 42 days, a week, a day, and the Agenda's three months all fall
 * inside it — and a month past the Agenda's own reach at the front.
 *
 * The reach is what makes paging free. The window follows the anchor, so when a
 * page lands, the span it shows is already inside the window fetched for the
 * page before it; the fetch that follows is for the page after, and lands while
 * the reader is looking at a list that is already complete.
 *
 * The week of slack at either end is what makes that true of the *edge* weeks as
 * well. Both the Month strip and the Agenda pad their span out to whole weeks,
 * so a page beginning on the 1st is drawn from the Sunday before it — which is
 * in the month before, outside a window that starts on a 1st. Paging back drew
 * that week from the 1st and then grew it upwards when the fetch landed,
 * pushing the list the reader was already reading down the page. The same week
 * at the far end, where the span runs a few days past the month it ends in.
 */
const windowFor = (anchor: dayjs.Dayjs) => {
	const first = anchor.startOf('month')
	return {
		from: first.subtract(1, 'month').subtract(1, 'week'),
		to: first.add(AGENDA_MONTHS, 'month').endOf('month').add(1, 'week'),
	}
}

const events = createResource({
	url: 'suite.calendar.api.get_calendar_events',
	makeParams: () => {
		const { from, to } = windowFor(anchorMonth.value)
		fetchedRange = { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') }
		return {
			account: store.accountId,
			from_date: from.utc().format('YYYY-MM-DD[T]HH:mm:ss[Z]'),
			to_date: to.utc().format('YYYY-MM-DD[T]HH:mm:ss[Z]'),
			time_zone: dayjs.tz.guess(),
		}
	},
	transform: (data) => data.map(transformEvent),
	onError: (error) => raiseToast(error.message, 'error'),
})

// Today's events, for the sidebar's upcoming list. Its own fetch rather than a
// filter over the grid's: the grid's window follows the month in view, and paged
// a couple of months from today it no longer holds today, so a list drawn from it
// went blank. Today is today whatever month is on screen. Asked for at once —
// the sidebar is on screen from the start, and the same shape as the grid's rows
// so the list and the card it opens read it the same way.
const todayEvents = createResource({
	url: 'suite.calendar.api.get_calendar_events',
	makeParams: () => {
		const start = dayjs().startOf('day')
		return {
			account: store.accountId,
			from_date: start.utc().format('YYYY-MM-DD[T]HH:mm:ss[Z]'),
			to_date: start.endOf('day').utc().format('YYYY-MM-DD[T]HH:mm:ss[Z]'),
			time_zone: dayjs.tz.guess(),
		}
	},
	auto: true,
	transform: (data) => data.map(transformEvent),
	onError: (error) => raiseToast(error.message, 'error'),
})

// Asked again as the date turns: a list of today's events fetched yesterday is
// yesterday's, and the clock the list already runs on says when.
watch(
	() => dayjs(now.value).format('YYYY-MM-DD'),
	() => todayEvents.reload(),
)

// The events themselves changed, as opposed to the window over them moving. The
// sidebar's mini month draws from its own density call, so it has no way to hear
// about a save or a delete unless it is told to forget what it has.
const reloadEvents = () => {
	events.reload()
	todayEvents.reload()
	invalidateEventDensity()
}

// The palette colour an event is drawn in, put on the event itself. Every
// surface that shows one — the grid, the rows, the sidebar's upcoming list, the
// detail card — reads `color`, so it is worked out in one place; the card used
// to miss out and fall back to the colour the server carries, which had one
// event green in the list and blue in the card beside it.
const withCalendarColor = (event) => ({
	...event,
	color: calendarColor(event.calendars[0]?.calendar),
})

/**
 * Whether the calendar has yet to be told what is in the window it is showing.
 *
 * `loading` alone is not that: it is false in the moment between mounting and the
 * request going out, and the Agenda — which has nothing to draw until events arrive —
 * used that moment to say the span had nothing on it. No data and no error yet is the
 * same not-knowing, so it counts too. An error does not: the toast has said what
 * happened, and a list waiting forever says nothing.
 */
const eventsPending = computed(
	() => events.loading || (!events.data && !events.error),
)

const onVisibleCalendar = (event) =>
	event.calendars.map((c) => c.calendar).some((cal) => visibleCalendars.value.includes(cal))

const visibleEvents = computed(
	() => events.data?.filter(onVisibleCalendar).map(withCalendarColor) || [],
)

const visibleTodayEvents = computed(
	() => todayEvents.data?.filter(onVisibleCalendar).map(withCalendarColor) || [],
)

const showEditEvent = ref(false)

const event = reactive({})

const withActualTitle = (event) => ({ ...event, title: event.actualTitle })

const handleOpenEvent = async (e) => {
	// Cleared on the way in rather than on the way out. Emptying it when the modal closed
	// re-rendered the modal while it was still fading: with no calendarEvent left it read
	// as a new event mid-animation, which enabled Save and put a remove button on every
	// participant. What the clearing is for is not leaking one event's keys into the next,
	// and doing it here is the same guarantee without the audience.
	Object.keys(event).forEach((key) => delete event[key])
	Object.assign(event, e, e.calendarEvent && { calendarEvent: withActualTitle(e.calendarEvent) })
	showEditEvent.value = true

	// The detail card goes, whatever it was showing: it is drawn over the form rather
	// than under it, so left open it puts the thing being edited behind a panel — one
	// describing it, from the card's own edit button or a double click on its pill, or
	// another event's, from a double click elsewhere. Awaited rather than run together:
	// the edit is written onto the query below, and until the close has landed that
	// query still carries the `?event=` this just dropped.
	await closeEventDetail()

	// Editing an existing event is addressable: ?edit=<id> (never for new-event
	// drafts, which have no id and no restorable form state). Its own key, apart
	// from the detail card's ?event=: the card is derived from that one,
	// so sharing it would open the sidebar under every double-clicked pill.
	const opened = e.calendarEvent
	const editing = opened?.master_id || opened?.id
	if (editing && route.query.edit !== editing)
		router.replace({
			query: {
				...route.query,
				// The master's id, for the same reason as the event link above.
				edit: editing,
				editRecurrence: opened.recurrence_id || undefined,
			},
		})
}

// --- Event detail card ---

const selectedCalendarEvent = ref(null)

// The open event lives in the URL (?event=<id>, plus &recurrence=<id> for a
// recurring instance): clicking a pill writes it, closing clears it, and the
// selection is DERIVED from it below — so event links are shareable, survive
// reload, and back/forward toggles the card. Deriving from events.data also
// keeps the sidebar in sync after edits/RSVPs (fresh copy swapped in, closed
// while the event is deleted or outside the fetched range).
const handleEventClick = ({ calendarEvent }) =>
	router.replace({
		query: {
			...route.query,
			// The master's id, not the row's. A row's id is synthetic — the server derives it
			// from the occurrence's position in the expansion — and it changes the moment that
			// occurrence gains an override, which editing or answering one gives it. A link
			// built from it stops resolving as soon as it is acted on, and the card loses the
			// event it is showing. The master's id does not move, and the recurrence id beside
			// it names the occurrence.
			event: calendarEvent.master_id || calendarEvent.id,
			recurrence: calendarEvent.recurrence_id || undefined,
		},
	})

// --- The rail's own open event (desktop) ---

// A row in the sidebar's upcoming list opens its card without touching the URL: a
// glance at what is coming, not the open event a link or a reload would restore.
// Held as the ids and looked up on every read, the way the URL's is, so a reload
// after an RSVP swaps in the fresh copy and a delete closes it. Today's list first,
// since that is where the rows come from, and it holds today when the grid's
// window has been paged away from it.
const railOpen = ref<{ id: string; recurrence?: string } | null>(null)

const railEvent = computed(() => {
	if (!railOpen.value) return null
	const { id, recurrence } = railOpen.value
	const linked =
		findLinkedEvent(todayEvents.data, id, recurrence) ?? findLinkedEvent(events.data, id, recurrence)
	return linked && withCalendarColor(linked)
})

// What the card shows: the URL's event, or the rail's. Opening either closes the
// other — see toggleEventDetail — so at most one of the two is set.
const openEvent = computed(() => selectedCalendarEvent.value ?? railEvent.value)

const closeEventDetail = () => {
	railOpen.value = null
	if (!route.query.event) return Promise.resolve()
	const { event: _event, recurrence: _recurrence, ...query } = route.query
	return router.replace({ query })
}


/** Edit, from the detail card or sheet — which handleOpenEvent closes on the way. */
const editFromDetail = () => handleOpenEvent({ calendarEvent: openEvent.value })

/** "August 2026" → the month and its year apart, so the year can be set in a lighter ink. */
const splitYear = (title: string) => {
	const match = /^(.*?)[,\s]*(\d{4})$/.exec(title || '')
	return match ? { label: match[1], year: match[2] } : { label: title, year: '' }
}

// The window follows the anchor: every page moves it, so the span that lands is
// already inside the window fetched for the page before it.
//
// Settled first, though. On mount the calendar reports its default view's range
// before the route's view is applied, so a reload straight into the Agenda
// announced the month's 42 days and then the agenda's three months. Both were
// fetched, and whichever answered last won: often the month's, leaving a
// three-month list holding six weeks of events. Only the range still standing
// at the end of the tick is worth asking about.
let rangeSettle: ReturnType<typeof setTimeout> | null = null

watch(visibleRange, (range) => {
	if (!range) return
	if (rangeSettle) clearTimeout(rangeSettle)
	rangeSettle = setTimeout(() => {
		rangeSettle = null
		if (!visibleRange.value) return

		// Keyed on the window this anchor wants, not on whether the span on screen
		// is covered. Covered was enough to avoid a wasted fetch, but it also meant
		// the window only moved when the reader had already run past its edge — so
		// every other press of next paid for a round trip and reflowed the list as
		// it landed. Moving the window on every page keeps it one page ahead, and
		// the fetch happens behind a view that is already complete.
		const wanted = windowFor(anchorMonth.value)
		const from = wanted.from.format('YYYY-MM-DD')
		const to = wanted.to.format('YYYY-MM-DD')
		if (fetchedRange && fetchedRange.from === from && fetchedRange.to === to) return

		events.reload()
	})
})

// The header names the period in view: the month for Month, the day for Day (the
// calendar's own title serves both), and for Week the days themselves — "Aug 23 – 29",
// or "Aug 30 – Sep 5" when the week straddles two months — rather than a month the
// week only partly belongs to.
const headerTitle = (title: string) => {
	const range = visibleRange.value
	if (range?.view !== 'Week') return splitYear(title)
	return weekSpanLabel(range.startDate, range.endDate)
}

// The header's "+ Event" opens on the period in view: starting an event while
// looking at next week should land in next week. Today wins whenever it is on
// screen, so the ordinary case still gets the modal's next-hour default.
const newEventDate = () => {
	const range = visibleRange.value
	if (!range) return new Date()

	const today = dayjs().format('YYYY-MM-DD')
	if (today >= range.startDate && today <= range.endDate) return new Date()

	// The Month strip's first week reaches back into the month before it, so a
	// month in view opens on its own 1st rather than on the strip's first day.
	const start = dayjs(range.startDate)
	return range.view === 'Month' ? start.add(1, 'week').startOf('month').toDate() : start.toDate()
}

// The mobile tab bar and Suite launcher ask for a new event through the URL
// (?new=1). Consume the flag so reload or Back does not reopen the modal.
const openNewEventFromRoute = (flag) => {
	if (!flag) return
	const { new: _new, ...query } = route.query
	router.replace({ query })
	handleOpenEvent({
		date: isMobile.value ? dayjs(mobileDate.value).toDate() : newEventDate(),
	})
}

watch(() => route.query.new, openNewEventFromRoute)

const unregisterPaletteGroups = useRootStore().registerPaletteGroups('calendar-view', [
	{
		commands: [
			{
				id: 'calendar-new-event',
				label: 'New event',
				enterHint: 'create event',
				icon: 'lucide-calendar-plus',
				keywords: ['create', 'add'],
				run: () => handleOpenEvent({ date: newEventDate() }),
			},
		],
	},
])
onScopeDispose(unregisterPaletteGroups)

// The grid's own keys are switched off (`enableShortcuts`) and registered here instead, with
// frappe-ui's shortcut registry, so the shortcuts dialog lists them beside the app's own.
const calendarShortcut = (combo: string, description: string, handler: () => void) => ({
	combo,
	description: __(description),
	group: __('Calendar'),
	enabled: () => !isMobile.value && !!calendarRef.value,
	handler,
})
useKeyboardShortcut([
	calendarShortcut('E', 'New Event', () => handleOpenEvent({ date: newEventDate() })),
	calendarShortcut('T', 'Go to Today', () => calendarRef.value.setCalendarDate()),
	calendarShortcut('ArrowLeft', 'Previous', () => calendarRef.value.decrement()),
	calendarShortcut('ArrowRight', 'Next', () => calendarRef.value.increment()),
	calendarShortcut('D', 'Day View', () => (calendarRef.value.activeView = 'Day')),
	calendarShortcut('W', 'Week View', () => (calendarRef.value.activeView = 'Week')),
	calendarShortcut('M', 'Month View', () => (calendarRef.value.activeView = 'Month')),
	calendarShortcut('A', 'Agenda View', () => (calendarRef.value.activeView = 'Agenda')),
])

// A pill in the grid and a row in the sidebar's upcoming list toggle the open
// event the way mail's list does: a second click on the open one closes it. The
// element clicked is kept, since on desktop the event opens as a card hung on it
// — see `cardAnchor` below. A pill's event goes in the URL; a row's stays here.
const toggleEventDetail = (calendarEvent, anchor: Element | null = null, viaRail = false) => {
	const open = openEvent.value
	clickedAnchor.value = anchor
	if (
		open &&
		open.id === calendarEvent.id &&
		(open.recurrence_id ?? '') === (calendarEvent.recurrence_id ?? '')
	)
		return closeEventDetail()
	if (!viaRail) return handleEventClick({ calendarEvent })
	// Whatever the URL had open goes first — closeEventDetail clears the rail's
	// too, which is why the row's is set after.
	closeEventDetail()
	railOpen.value = {
		// The master's id, as the URL carries it — see handleEventClick.
		id: calendarEvent.master_id || calendarEvent.id,
		recurrence: calendarEvent.recurrence_id || undefined,
	}
}

// --- The card (desktop) ---

// The element a click landed on, and the one the card hangs on. They part when
// the grid is redrawn under an open card: a reload after an RSVP keeps the pill
// (it is keyed on the event's id), but a change of view or of month draws the
// event's pill afresh or not at all. So the card's anchor is resolved again after
// every such redraw, from the clicked one while it still stands and otherwise
// from the mark the calendar puts on the open event — `CalendarActiveEvent`,
// drawn as `.active` on the pill — which finds the redrawn pill wherever the new
// view put it. With nothing anywhere to hang on, the event closes: a card has to
// be beside something, and there is no second surface to show it in.
const clickedAnchor = ref<Element | null>(null)
const cardAnchor = ref<Element | null>(null)

// The calendar's pills in the grids and its rows in the agenda, by the classes it
// styles them with. Looked for from the click's target up, not its currentTarget:
// the calendar hands the click over 200ms after it landed, once it knows no second
// click is coming, and by then the event's currentTarget has been unset. The
// grid's own element, not the Calendar's `$el`: its template opens with a comment,
// which the dev build keeps, and a component whose root is a fragment has a text
// anchor for an `$el`, with nothing to query.
const PILL_SELECTOR = '.event, .calendar-row'
const gridRef = useTemplateRef<HTMLElement>('grid')

const pillOf = (e: Event) => (e.target instanceof Element ? e.target.closest(PILL_SELECTOR) : null)
// A row of the rail hands its click over as it happens, so currentTarget is still the row.
const rowOf = (e: Event) => (e.currentTarget instanceof Element ? e.currentTarget : null)

const activePill = () =>
	gridRef.value?.querySelector('.event.active, .calendar-row.active') ?? null

watch([openEvent, visibleRange], async ([open]) => {
	// The phone has no card: its open event is the sheet's, which hangs on
	// nothing, and a search for a pill there would find none and close it.
	if (!open || isMobile.value) {
		clickedAnchor.value = null
		cardAnchor.value = null
		return
	}
	// After the flush, so the redrawn grid — and the active mark on it — is there
	// to be asked. What was showing keeps showing until then, so a reload does not
	// blink the card.
	await nextTick()
	if (!openEvent.value) return
	cardAnchor.value = clickedAnchor.value?.isConnected ? clickedAnchor.value : activePill()
	if (!cardAnchor.value) closeEventDetail()
})

// A row's card opens to the right of the rail; a pill's beside it in the grids,
// where the column beside it has room, and under it in the day and the agenda,
// whose rows run the whole width.
const cardInGrid = computed(() => !!cardAnchor.value && !!gridRef.value?.contains(cardAnchor.value))

const cardSide = computed(() => {
	if (!cardInGrid.value) return 'right'
	const view = visibleRange.value?.view
	return view === 'Month' || view === 'Week' ? 'left' : 'bottom'
})

// The calendar draws the open event's pill raised. Set from here rather than left
// to the click: closing clears the mark, and a grid click — which the calendar
// uses to let go of the mark — is put right by the next change.
watch(openEvent, (open) => {
	CalendarActiveEvent.value = open?.id ?? ''
})

// Which row the sheet was opened from. An event spanning several days has a row on
// each of them and they are the same event, so the id alone cannot say which was
// tapped — the day goes with it. Cleared when the sheet closes, so a later deep link
// does not inherit a stale row.
const openRow = ref('')

const openEventRow = (event: any, date: string) => {
	const key = `${event.id + (event.recurrence_id ?? '')}@${date}`
	// The row is what toggles, not the event behind it: tapping the row whose sheet is
	// open closes it, and tapping another day of the same multi-day event moves to that
	// day rather than reading as "the open event again" and closing.
	if (key === openRow.value) return closeEventDetail()
	openRow.value = key
	handleEventClick({ calendarEvent: event })
}

watch(selectedCalendarEvent, (open) => {
	if (!open) openRow.value = ''
})

// The calendar app has no compose surface of its own — hand over to mail's
// compose window via its deep link (mailto: would depend on the OS having a
// mail handler; the suite IS the mail client). Path, not route name: mail's
// routes register lazily on first navigation into /mail.
const emailParticipants = (emails: string[]) => {
	router.push({ path: '/mail', query: { compose: '1', to: emails.join(',') } })
}

// A deep link can only be built from the ids its author has. The grid's own
// events come out of a recurrence-expanded query, so each carries a synthetic
// per-instance id and wears the real event's id as `master_id` — but mail's
// invite strip resolves an invite's UID to that master id, which matches
// nothing here. So a link that misses on id falls back to the master, narrowed
// to the instance covering the routed day (the day the link itself picked).
const findLinkedEvent = (data, id, recurrence) => {
	if (!data || !id) return null

	const rec = (recurrence as string) ?? ''
	const exact = data.find((e) => e.id === id && (e.recurrence_id ?? '') === rec)
	if (exact) return exact

	const instances = data.filter((e) => e.master_id === id)
	if (!instances.length) return null
	if (rec) return instances.find((e) => (e.recurrence_id ?? '') === rec) ?? null

	const { year, month, day } = route.params
	const routed = year && month && day ? dayjs(`${year}-${month}-${day}`, 'YYYY-M-D') : null
	if (!routed?.isValid()) return instances[0]

	const routedDay = routed.format('YYYY-MM-DD')
	return instances.find((e) => e.fromDate <= routedDay && routedDay <= e.toDate) ?? instances[0]
}

watch(
	[() => events.data, () => todayEvents.data, () => route.query.event, () => route.query.recurrence],
	([data, today, id, recurrence]) => {
		// Resolved against every event, not just the visible ones: a link to an
		// event in a calendar the reader has unticked still opens it. The colour
		// goes on here, since this list has not been through `visibleEvents`.
		// Today's list as well as the grid's: a row of the rail opens its event
		// wherever the grid has been paged to, and today may be outside its window.
		const linked = findLinkedEvent(data, id, recurrence) ?? findLinkedEvent(today, id, recurrence)
		selectedCalendarEvent.value = linked && withCalendarColor(linked)
	},
	{ immediate: true },
)

watch(
	() => showEditEvent.value,
	(val) => {
		if (val) return
		// The form state stays until the next open clears it, so the modal has something
		// to draw while it fades. Closing the modal drops only its own keys — the detail
		// sidebar (?event=) stays.
		if (route.query.edit) {
			const { edit: _edit, editRecurrence: _rec, ...query } = route.query
			router.replace({ query })
		}
	},
)

// Restore the edit modal from ?edit=<id> (reload, shared link), and close it
// when back/forward removes the param. Guards: never touch an already-open
// modal (events reloading in the background must not stomp form state), and
// never close a NEW-event draft (those carry no calendarEvent and own no query).
watch(
	[() => events.data, () => route.query.edit, () => route.query.editRecurrence],
	([data, id, recurrence]) => {
		if (!id) {
			if (showEditEvent.value && event.calendarEvent) showEditEvent.value = false
			return
		}
		if (showEditEvent.value) return
		const match = findLinkedEvent(data, id, recurrence)
		if (match) handleOpenEvent({ calendarEvent: match })
	},
	{ immediate: true },
)

const eventToBeUpdated = reactive({})
const showRecurringEventModal = ref(false)
const updateScope = ref<RecurringScope>('series')
const showNotifyModal = ref(false)

// The calendar draws a move or resize before it is confirmed here. Until a
// dialog button answers, the change is only on screen: a dialog closed by its
// X or a click outside, or a save that fails, puts the pill back where it was
// by re-syncing the calendar's copy of the events from ours.
let confirmed = false
const revertUpdate = () => calendarRef.value?.reloadEvents()

watch([showRecurringEventModal, showNotifyModal], ([recurring, notify]) => {
	if (!recurring && !notify && !confirmed) revertUpdate()
})

const handleUpdate = (e) => {
	Object.assign(eventToBeUpdated, withActualTitle(e))
	// Both remembered before the drag overwrites them: an occurrence's override has to keep the
	// zone the event arrived with, and saving the whole series needs the start the reader was
	// looking at to measure what they changed.
	eventToBeUpdated.masterTimeZone = e.time_zone
	eventToBeUpdated.startBeforeDrag = e.start
	confirmed = false
	// Each drag asks again. Left standing, the last drag's answer would decide this one — and a
	// one-off event dragged after an instance edit would be written as an override of a series
	// it isn't part of.
	updateScope.value = 'series'
	if (e.recurrence_id) showRecurringEventModal.value = true
	else handleUpdateEvent()
}

const handleUpdateRecurringEvent = (scope: RecurringScope) => {
	updateScope.value = scope
	showRecurringEventModal.value = false
	handleUpdateEvent()
}

const handleUpdateEvent = () => {
	// A draft has sent nothing, so there is no one to notify of a move.
	if (hasParticipantsOtherThanUser.value && !eventToBeUpdated.isDraft) showNotifyModal.value = true
	else submitEvent(false)
}

const hasParticipantsOtherThanUser = computed(
	() =>
		eventToBeUpdated.participants?.some((p) =>
			participantIdentities.data.every((i) => i.email !== p.email),
		) ?? false,
)

const submitEvent = (sendEmail: boolean) => {
	confirmed = true
	showNotifyModal.value = false
	eventToBeUpdated.start = dayjs(eventToBeUpdated.fromDateTime).format('YYYY-MM-DDTHH:mm:ss')
	if (!eventToBeUpdated.isAllDay) {
		// The dragged wall clock is in the viewer's zone; re-zone the event to match, or the
		// same numbers would be reinterpreted in the event's original zone.
		eventToBeUpdated.time_zone = dayjs.tz.guess()
		const start = dayjs(eventToBeUpdated.fromDateTime)
		const end = dayjs(eventToBeUpdated.toDateTime)
		const diff = dayjs.duration(end.diff(start))
		const hours = Math.floor(diff.asHours())
		const minutes = diff.minutes()
		eventToBeUpdated.duration = dayjs.duration({ hours, minutes }).toISOString()
	}

	// One occurrence moved on its own: the series keeps its rule and this date gets an
	// override. The series is addressed by master_id and the occurrence within it by its
	// recurrence id — the start it was expanded at, which the drag leaves alone. The id the
	// grid holds is no use for that: the server derives it from the occurrence's position in
	// the expansion, and a later override renumbers it onto a different date.
	if (updateScope.value === 'instance') return editEventInstance.submit({ sendEmail })

	// Saving the whole series from one of its occurrences. The grid is showing one occurrence,
	// so its start is that occurrence's — sending it as the master's drags the anchor onto this
	// week and drops every occurrence before it, which is the first one vanishing when the
	// second is moved. What carries over is the difference the reader made, applied to the
	// master's own start, and the master keeps its own zone: pairing its wall clock with the
	// viewer's would move the series again on its own.
	if (updateScope.value === 'series' && eventToBeUpdated.master_start) {
		eventToBeUpdated.start = shiftedMasterStart(
			eventToBeUpdated.master_start,
			shownStart(eventToBeUpdated.startBeforeDrag),
			dayjs(eventToBeUpdated.fromDateTime),
		)
		eventToBeUpdated.time_zone = eventToBeUpdated.masterTimeZone || eventToBeUpdated.time_zone
	}

	// A rule reads its days off the start once and never again, so an anchor dragged onto
	// another weekday leaves the series repeating on the old one — and the occurrence just
	// dragged matches nothing the rule generates, so it is not drawn at all. The selectors
	// follow the anchor, and which start was the anchor depends on what is being written: the
	// whole series is anchored at the master's start, while the half a split begins is
	// anchored at the occurrence the reader dragged.
	// Both ends of the move read in the same zone. The recurrence id and the master start are
	// wall clocks in the event's; the dragged start has just been written in the viewer's for
	// the series path, and left in the event's for a split.
	// The half a split begins is anchored where the reader saw this occurrence, and starts at
	// the clock they dragged it to — both the viewer's. The whole series is anchored at the
	// master's start and moves to the shifted one — both the event's. Reading one of each would
	// measure a change nobody made.
	const anchorWas =
		updateScope.value === 'following'
			? shownStart(eventToBeUpdated.startBeforeDrag)
			: dayjs(eventToBeUpdated.master_start)
	if (
		anchorWas?.isValid() &&
		eventToBeUpdated.recurrence_rule &&
		!anchorWas.isSame(dayjs(eventToBeUpdated.start), 'day')
	)
		eventToBeUpdated.recurrence_rule = reanchoredRule(
			eventToBeUpdated.recurrence_rule,
			anchorWas,
			dayjs(eventToBeUpdated.start),
		)

	// This occurrence and the ones after it: the series is cut here and the move starts its
	// second half, since a rule has no way to change partway through. The new half is a new
	// event, so unlike an override it carries the zone the drag was made in.
	if (updateScope.value === 'following') return splitSeries.submit({ sendEmail })

	editEvent.submit({ sendEmail })
}

// The clock the grid was showing for a start it holds. An all-day event is drawn on its stored
// date without being re-read in the viewer's zone, so re-reading one here would measure a change
// against a time nobody saw — and move the event by the zone's offset.
const shownStart = (start: string) =>
	eventToBeUpdated.isAllDay ? dayjs(start) : fromEventZone(start, eventToBeUpdated.masterTimeZone)

// The dragged numbers are a wall clock in the viewer's zone; an occurrence keeps the series'
// zone, so the instant is re-expressed in it. An all-day occurrence has no clock to convert.
const instanceStart = () => {
	const eventZone = eventToBeUpdated.masterTimeZone || eventToBeUpdated.time_zone
	if (eventToBeUpdated.isAllDay || !eventZone || !dayjs?.tz) return eventToBeUpdated.start
	return dayjs
		.tz(eventToBeUpdated.fromDateTime, dayjs.tz.guess())
		.tz(eventZone)
		.format('YYYY-MM-DD[T]HH:mm:ss')
}

// Both writes land the same way: the calendar has already drawn the move, so success only has
// to confirm it and refresh, and a failure has to put the pill back where it was.
const onEventSaved = {
	onSuccess: () => {
		raiseToast(__('Event updated.'), 'success')
		reloadEvents()
	},
	onError: (error) => {
		revertUpdate()
		raiseToast(error.message, 'error')
	},
}

const editEventInstance = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event_instance',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		account: eventToBeUpdated.account,
		master_id: eventToBeUpdated.master_id,
		recurrence_id: eventToBeUpdated.recurrence_id,
		// Only what a drag can change, and never the zone: an occurrence is keyed by the start
		// it was expanded at, and a zone here makes the server re-key it into that zone while
		// the override stays under the old key — the two stop matching and the occurrence
		// keeps nothing the series says. The dragged wall clock is converted instead.
		patch: {
			start: instanceStart(),
			duration: eventToBeUpdated.duration,
		},
		send_scheduling_messages: sendEmail,
	}),
	...onEventSaved,
})

const splitSeries = createResource({
	url: 'suite.calendar.api.split_calendar_event_series',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		...eventToBeUpdated,
		master_id: eventToBeUpdated.master_id,
		recurrence_id: eventToBeUpdated.recurrence_id,
		send_scheduling_messages: sendEmail,
	}),
	...onEventSaved,
})

const editEvent = createResource({
	url: 'suite.calendar.doctype.calendar_event.calendar_event.update_calendar_event',
	makeParams: ({ sendEmail }: { sendEmail: boolean }) => ({
		...eventToBeUpdated,
		// master_id is only set on recurring events; fall back to the event's own id
		id: eventToBeUpdated.master_id || eventToBeUpdated.id,
		send_scheduling_messages: sendEmail,
	}),
	...onEventSaved,
})

const recurringScopeModalProps = computed(() => ({
	title: __('Update repeating event'),
	// See the event modal: nothing precedes the first occurrence, so the narrower answer
	// there is the wider one.
	options: scopeOptions({ isFirst: isFirstOccurrence(eventToBeUpdated) }),
	confirmLabel: __('Update'),
	loading: editEvent.loading || editEventInstance.loading || splitSeries.loading,
}))

const NOTIFY_MODAL_OPTIONS = {
	title: __('Notify Participants'),
	icon: 'lucide-bell',
	message: __('Send an email to let attendees know this event has been updated?'),
}
</script>

<template>
	<!-- h-full, not a viewport unit: on a phone the layout owns the height and hands
	     this view what is left above the tab bar; on a desktop it is the page. A dvh
	     here made the view a whole viewport tall inside a box that was a tab bar
	     shorter, so its last 60px sat under the bar — which in the day grid is where
	     11 pm is, scrolled to and never arriving. -->
	<div class="flex h-full min-h-0 w-full min-w-0 flex-col sm:h-screen">
		<div v-if="!isMobile" class="flex min-h-0 min-w-0 flex-1">
			<AppSidebar
				:calendars="coloredCalendars"
				:calendar-color="calendarColor"
				:visible-calendars
				:month="calendarRef?.currentMonth"
				:year="calendarRef?.currentYear"
				:day="calendarRef?.currentDay"
				:events="visibleTodayEvents"
				:selected-event="openEvent"
				@update:visible-calendars="
					(name) =>
						visibleCalendars.includes(name)
							? visibleCalendars.splice(visibleCalendars.indexOf(name), 1)
							: visibleCalendars.push(name)
				"
				@select-date="(date) => calendarRef?.setCalendarDate(date)"
				@select-event="(event, e) => toggleEventDetail(event, rowOf(e), true)"
			/>
			<div ref="grid" class="min-h-0 min-w-0 flex-1 p-4">
				<Calendar
					ref="calendar"
					:events="visibleEvents"
					:loading="eventsPending"
					:config="{ isEditMode: true, enableShortcuts: false }"
					:on-click="({ e, calendarEvent }) => toggleEventDetail(calendarEvent, pillOf(e))"
					:on-dbl-click="(event) => handleOpenEvent(event)"
					:on-cell-click="(event) => handleOpenEvent(event)"
					@update="handleUpdate"
					@range-change="(range) => (visibleRange = range)"
				>
					<!-- The month is a label, not a picker: the sidebar's mini month is
					     where a date gets chosen. The year sits beside it, muted. -->
					<template
						#header="{ currentMonthYear, enabledModes, activeView, decrement, increment, updateActiveView, setCalendarDate }"
					>
						<!-- Navigation leads: back, Today, forward, then the title they change,
						     so the title's length moves nothing. New event sits at the far
						     right, past the view switcher. -->
						<div class="mb-4 flex items-center justify-between">
							<div class="flex items-center gap-x-1">
								<Button
									variant="ghost"
									icon="lucide-chevron-left"
									:tooltip="__('Previous (←)')"
									@click="decrement"
								/>
								<Button
									variant="ghost"
									:label="__('Today')"
									:tooltip="__('Go to Today (T)')"
									@click="setCalendarDate()"
								/>
								<Button
									variant="ghost"
									icon="lucide-chevron-right"
									:tooltip="__('Next (→)')"
									@click="increment"
								/>
								<div class="flex items-baseline gap-1.5 px-2 text-lg leading-5">
									<span class="font-medium text-ink-gray-9">{{ headerTitle(currentMonthYear).label }}</span>
									<span v-if="headerTitle(currentMonthYear).year" class="text-ink-gray-4">
										{{ headerTitle(currentMonthYear).year }}
									</span>
								</div>
							</div>
							<div class="flex items-center gap-x-2">
								<!-- md, like the buttons either side of it: at the default sm the
								     switcher sat 4px shorter than the Event button beside it. -->
								<TabButtons
									size="md"
									:options="enabledModes"
									:model-value="activeView"
									@update:model-value="(view) => updateActiveView(view)"
								/>
								<Button
									variant="solid"
									icon-left="lucide-calendar-plus"
									:label="__('Event')"
									:tooltip="__('New Event (E)')"
									@click="handleOpenEvent({ date: newEventDate() })"
								/>
							</div>
						</div>
					</template>

					<!-- The rail's and agenda's rows have room for what a pill does
					     not: where the event is, and how often it repeats. Who is
					     coming is the row's own far end, from `participant`. frappe-ui
					     hands back what it worked out itself, so this adds to it
					     rather than deriving it twice — the same line the phone's
					     agenda shows, from the same helper. -->
					<template #event-description="{ calendarEvent, date }">
						{{ eventRowDescription(calendarEvent, calendarDaySpan(calendarEvent, date)) }}
					</template>
				</Calendar>
			</div>
			<!-- The open event, as a card hung on its pill, or on its row in the rail.
			     Its own popover rather than the calendar's: that one opens and closes
			     on the pill's own say-so, where this one is the URL's — ?event= opens
			     it, closing clears it, and a link or a reload lands on the same card.
			     Not keyed on the event: the popover stays up while the event under it
			     changes, and only what is in it is rebuilt, so moving from one pill to
			     the next does not blink. -->
			<EventPopover
				:open="!!cardAnchor"
				:anchor="cardAnchor"
				:anchor-moves="cardInGrid"
				:side="cardSide"
				@close="closeEventDetail"
			>
				<EventDetail
					v-if="openEvent"
					:key="openEvent.id + (openEvent.recurrence_id ?? '')"
					variant="popover"
					:calendar-event="openEvent"
					@close="closeEventDetail"
					@edit="editFromDetail"
					@reload-events="reloadEvents"
					@email-participants="emailParticipants"
				/>
			</EventPopover>
		</div>

		<!-- The phone. Agenda is home — a week strip for orientation and the list of
		     what is coming — with the month a tap away and the same events under it.
		     The tab bar and its FAB are the app's own chrome here, as mail's are. -->
		<MobileCalendar
			v-else
			:view="mobileView"
			:events="visibleEvents"
			:selected="mobileDate"
			:now="now"
			:loading="eventsPending"
			:calendar-color="calendarColor"
			@select-date="(date) => (mobileDate = date)"
			@select-view="(view) => (mobileView = view)"
			@select-event="openEventRow"
			@select-slot="handleOpenEvent"
		/>
	</div>
	<EventDetailSheet
		v-if="isMobile"
		:calendar-event="selectedCalendarEvent"
		@close="closeEventDetail"
		@edit="editFromDetail"
		@reload-events="reloadEvents"
		@email-participants="emailParticipants"
	/>
	<EventModal v-model="showEditEvent" :selected-event="event" @reload-events="reloadEvents" />
	<RecurringScopeModal
		v-model="showRecurringEventModal"
		v-bind="recurringScopeModalProps"
		@confirm="handleUpdateRecurringEvent"
	/>
	<Dialog v-model:open="showNotifyModal" v-bind="NOTIFY_MODAL_OPTIONS">
		<template #actions>
			<div class="flex justify-end space-x-2">
				<Button variant="outline" @click="submitEvent(false)"> {{ __('Skip') }} </Button>
				<Button variant="solid" @click="submitEvent(true)">
					{{ __('Send Email') }}
				</Button>
			</div>
		</template>
	</Dialog>
</template>
