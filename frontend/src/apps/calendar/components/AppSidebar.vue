<script setup lang="ts">
import { computed, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Ellipsis, Keyboard, LogOut, Plus, Settings, User } from 'lucide-vue-next'
import {
	Button,
	Dropdown,
	Sidebar,
	SidebarCollapseToggle,
	SidebarHeader,
	SidebarItem,
	SidebarSection,
	Tooltip,
} from 'frappe-ui'
import { eventColor } from '@/apps/calendar/utils/color'
import { useNow, useStorage } from '@vueuse/core'

import { useSessionStore } from '@/boot/session'
import { accountSubmenu } from '@/composables/accountSubmenu'
import { useAppSwitcher } from '@/composables/useAppSwitcher'
import dayjs from '@/apps/calendar/utils/dayjs'
import { toTitleCase } from '@/apps/calendar/utils/format'
import { brandingStore } from '@/apps/calendar/stores/branding'
import { userStore } from '@/apps/calendar/stores/user'
import CalendarLogo from '@/apps/calendar/components/Icons/CalendarLogo.vue'
import MiniMonth from '@/apps/calendar/components/MiniMonth.vue'
import UpcomingEvents from '@/apps/calendar/components/UpcomingEvents.vue'
import CalendarModal from '@/apps/calendar/components/Modals/CalendarModal.vue'
import DeleteCalendarModal from '@/apps/calendar/components/Modals/DeleteCalendarModal.vue'
import { useCalendarActions } from '@/apps/calendar/composables/useCalendarActions'
import CommandPaletteSidebarItem from '@/shell/CommandPaletteSidebarItem.vue'
import { useShortcuts } from '@/apps/calendar/composables/useShortcuts'
import type { CalendarRow } from '@/apps/calendar/utils/calendars'

const { events, selectedEvent } = defineProps<{
	/** The month the calendar shows; the mini month mirrors it. */
	month?: number
	year?: number
	/** The day it is on, for the mini month's selection. */
	day?: number
	/** Today's events: `fromDate`/`toDate` in the viewer's zone, a palette `color`. */
	events?: any[]
	/** The open event, so its row reads as active. */
	selectedEvent?: any
	/** Palette colour per calendar id, for its dot here and the mini month's. */
	calendarColor: (calendar: string) => string
}>()

const emit = defineEmits<{
	selectDate: [date: Date]
	selectEvent: [event: any, e: MouseEvent]
}>()


const dotStyle = (color: string) => ({ background: eventColor(color) })

// The account's own calendars, then those shared with the user from other accounts. The shared
// section is only there when something is shared.
const calendarGroups = computed(() => {
	const calendars = store.calendars.data ?? []
	const mine = calendars.filter((calendar) => calendar.account === store.accountId)
	const shared = calendars.filter((calendar) => calendar.account !== store.accountId)
	return [
		{ key: 'mine', label: __('My Calendars'), calendars: mine },
		...(shared.length ? [{ key: 'shared', label: __('Shared Calendars'), calendars: shared }] : []),
	]
})

// Which sections are folded, remembered in this browser.
const collapsedSections = useStorage<string[]>('calendar-collapsed-sections', [])
const setSectionCollapsed = (key: string, collapsed: boolean) =>
	(collapsedSections.value = collapsed
		? [...collapsedSections.value, key]
		: collapsedSections.value.filter((k) => k !== key))

/** A shared calendar's owner, for its tooltip. */
const ownerName = (calendar: CalendarRow) =>
	calendar.account === store.accountId
		? ''
		: (user.data.all_accounts.find((a) => a.id === calendar.account)?._name ?? '')

// A JMAP calendar is often named after its account — "Frappe Calendar
// (akash@frappe.io)" — which never fits a sidebar row. The email moves to a
// tooltip; once there are several accounts the colour dot tells them apart.
const calendarLabel = (calendar: any) => {
	const match = /^(.*?)\s*\(([^()]*@[^()]*)\)$/.exec(calendar._name || '')
	return match ? { label: match[1], email: match[2] } : { label: calendar._name, email: '' }
}

// --- Upcoming events: what is left of today, like mail's sidebar shows ---
// The events handed over are today's already; this drops what is over, cancelled
// or declined, and puts the rest in order.

const now = useNow({ interval: 30_000 })

const upcoming = computed(() => {
	const current = dayjs(now.value)
	const today = current.format('YYYY-MM-DD')
	return (events || [])
		.filter((event) => {
			if (event.status === 'Cancelled' || event.isDeclined) return false
			if (event.fromDate > today || event.toDate < today) return false
			// An all-day event covers the whole of today; a timed one is over once its end has passed.
			return event.isAllDay || dayjs(`${event.toDate} ${event.toTime}`).isAfter(current)
		})
		// Sorted on the shape transformEvent hands over — date plus wall clock. An
		// all-day event starts at midnight, so it leads the day on its own.
		.sort((a, b) => `${a.fromDate} ${a.fromTime}`.localeCompare(`${b.fromDate} ${b.fromTime}`))
})

const isOpen = (event: any) =>
	!!selectedEvent &&
	selectedEvent.id === event.id &&
	(selectedEvent.recurrence_id ?? '') === (event.recurrence_id ?? '')

/** The dot beside an upcoming event, in its calendar's colour. */
const eventDotColor = (event: any) => eventColor(event.color)

const route = useRoute()
const router = useRouter()
const { branding } = brandingStore()
const { logout } = useSessionStore()
const store = userStore()

const user = inject('$user')

const title = computed(() =>
	branding.data?.brand_name && branding.data?.brand_name != 'Frappe'
		? branding.data.brand_name
		: 'Calendar',
)

const subtitle = computed(() => {
	// A user with no personal account and no stored id leaves `accountId` empty,
	// and the find unmatched — as mail's sidebar already allows for.
	const currentAccount = user.data.accounts.find((a) => a.id === store.accountId)
	if (!currentAccount || currentAccount.is_personal) return toTitleCase(user.data.full_name)
	return currentAccount._name
})

const appsMenuOption = useAppSwitcher('calendar')
const { openShortcuts } = useShortcuts()

const calendarActions = useCalendarActions()
const { selected: selectedCalendar, showEdit: showCalendarModal, showDelete: showDeleteCalendar } =
	calendarActions

const openSettings = inject<() => void>('openCalendarSettings')!
const isSidebarCollapsed = useStorage('isSidebarCollapsed', false)

const menuItems = computed(() => [
	{
		group: '',
		options: [appsMenuOption.value],
	},
	{
		group: '',
		options: [
			{
				icon: Settings,
				label: __('Settings'),
				onClick: openSettings,
			},
			{
				icon: Keyboard,
				label: __('Shortcuts'),
				onClick: openShortcuts,
			},
		],
	},
	{
		group: '',
		options: [
			{
				icon: User,
				label: __('Accounts'),
				submenu: accountSubmenu(user.data.accounts, store.accountId, (accountId) =>
					router.push({ name: route.name, params: { ...route.params, accountId } }),
				),
				condition: () => user.data.accounts?.length > 1,
			},
			{
				icon: LogOut,
				label: __('Log Out'),
				onClick: logout.submit,
			},
		],
	},
])

</script>

<template>
	<Sidebar
		v-model:collapsed="isSidebarCollapsed"
		class="hidden border-r border-outline-gray-1 sm:flex"
	>
		<!-- No padding around the header: its own inset centres the logo in the
		     collapsed rail, in line with the icons of the px-2 body below. -->
		<div class="flex h-full flex-col">
			<SidebarHeader :title="title" :subtitle="subtitle" :menu-items="menuItems" :logo="branding.data?.brand_html || CalendarLogo" />
			<div class="flex-1 overflow-y-auto overflow-x-hidden px-2">
				<SidebarSection>
					<CommandPaletteSidebarItem />
				</SidebarSection>
				<!-- Stays mounted through a collapse and folds in step with the
				     sidebar's 300ms width animation, like frappe-ui's own labels
				     (they animate w-0/opacity-0; height is our axis). A fixed width
				     — the expanded sidebar's inner 224px — keeps the seven columns
				     from reflowing while the width is mid-transition: the rail's
				     overflow clips the card instead.

				     The open end of that fold is a clamp, not a height, so it has to
				     clear the card rather than describe it: 384px against a card of
				     roughly 330 once its days grew a circled numeral and a tick
				     under it. At 288 it cut the last row of dates off, and a clamp
				     that clips reads as a card that ends mid-month. -->
				<div
					v-if="month != null && year != null"
					class="w-56 transition-all duration-300 ease-in-out"
					:class="
						isSidebarCollapsed ? 'mb-0 max-h-0 overflow-hidden opacity-0' : 'mb-3 mt-3 max-h-96 opacity-100'
					"
				>
					<MiniMonth
						:month
						:year
						:calendar-color="calendarColor"
						:selected="day != null ? new Date(year, month, day) : undefined"
						@select="(date) => emit('selectDate', date)"
					/>
				</div>
				<!-- Collapsed, frappe-ui swaps a section's label for a divider line. That
				     separates groups in mail's rail, but with a single section here it is a
				     stray line under the header — so the line is hidden. The label itself
				     stays: frappe-ui fades it with the width, where unsetting it dropped it
				     in one frame and jumped the rows up. -->
				<SidebarSection
					v-for="group in calendarGroups"
					:key="group.key"
					:label="group.label"
					:collapsible="calendarGroups.length > 1"
					:collapsed="collapsedSections.includes(group.key)"
					class="[&_hr]:hidden"
					@update:collapsed="(collapsed) => setSectionCollapsed(group.key, collapsed)"
				>
					<!-- A calendar that is switched off keeps its place but loses its colour. -->
					<SidebarItem
						v-for="calendar in group.calendars"
						:key="calendar.name"
						:label="calendar._name"
						:on-click="() => calendarActions.toggleVisible(calendar)"
					>
						<template #prefix>
							<!-- One size collapsed and expanded, centred in the 16px icon box. 10px, about
							     cap height: at 12 a filled dot outweighed the label and the outline + below. -->
							<span class="grid size-4 place-items-center">
								<span
									class="size-2.5 rounded-full transition-opacity"
									:class="!calendar.visible && 'opacity-30'"
									:style="dotStyle(calendarColor(calendar.name))"
								/>
							</span>
						</template>
						<Tooltip :text="calendarLabel(calendar).email || ownerName(calendar)" side="right">
							<span
								class="truncate text-sm"
								:class="!calendar.visible && 'text-ink-gray-4'"
							>
								{{ calendarLabel(calendar).label }}
							</span>
						</Tooltip>
						<template #suffix>
							<Dropdown
								v-if="calendarActions.hasMenuOptions(calendar)"
								:options="calendarActions.menuOptions(calendar)"
							>
								<Button
									variant="ghost"
									class="!bg-transparent"
									:aria-label="__('Calendar options')"
									@click.stop
								>
									<template #icon>
										<Ellipsis
											class="size-4 text-ink-gray-6 opacity-0 group-hover/sidebar-item:opacity-100 group-focus-within/sidebar-item:opacity-100 [@media(hover:none)]:opacity-100"
										/>
									</template>
								</Button>
							</Dropdown>
						</template>
					</SidebarItem>
					<SidebarItem
						v-if="group.key === 'mine'"
						:label="__('New Calendar')"
						:icon="Plus"
						:on-click="calendarActions.create"
					/>
				</SidebarSection>
			</div>
			<!-- Pinned under the scrolling body, as mail's sidebar keeps it. -->
			<div class="mt-auto p-2">
				<UpcomingEvents
					:events="upcoming"
					:is-collapsed="isSidebarCollapsed"
					:is-open
					:event-color="eventDotColor"
					@select="(event, e) => emit('selectEvent', event, e)"
				/>
				<SidebarCollapseToggle />
			</div>
		</div>
	</Sidebar>
	<CalendarModal v-model="showCalendarModal" :calendar="selectedCalendar" />
	<DeleteCalendarModal v-model="showDeleteCalendar" :calendar="selectedCalendar" />
</template>
