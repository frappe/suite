<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOut, Settings, User } from 'lucide-vue-next'
import {
	Sidebar,
	SidebarCollapseToggle,
	SidebarHeader,
	SidebarItem,
	SidebarSection,
	Tooltip,
} from 'frappe-ui'
import { CalendarColorMap } from 'frappe-ui/experimental'
import { useNow, useStorage } from '@vueuse/core'

import { useSessionStore } from '@/boot/session'
import { useAppSwitcher } from '@/composables/useAppSwitcher'
import dayjs from '@/apps/calendar/utils/dayjs'
import { toTitleCase } from '@/apps/calendar/utils/format'
import { brandingStore } from '@/apps/calendar/stores/branding'
import { userStore } from '@/apps/calendar/stores/user'
import CalendarLogo from '@/apps/calendar/components/Icons/CalendarLogo.vue'
import MiniMonth from '@/apps/calendar/components/MiniMonth.vue'
import UpcomingEvents from '@/apps/calendar/components/UpcomingEvents.vue'
import SettingsModal from '@/apps/calendar/components/Modals/SettingsModal.vue'

const { calendars, visibleCalendars, events, selectedEvent } = defineProps<{
	/** Each with a palette `color`, the one its events wear. */
	calendars: any[]
	visibleCalendars: string[]
	/** The month the calendar shows; the mini month mirrors it. */
	month?: number
	year?: number
	/** The day it is on and the view it is in, for the mini month's selection. */
	day?: number
	view?: 'Month' | 'Week' | 'Day'
	/** The calendar's own events: `fromDate`/`toDate` in the viewer's zone, a palette `color`. */
	events?: any[]
	/** The event whose detail panel is open, so its row reads as active. */
	selectedEvent?: any
}>()

const emit = defineEmits<{
	'update:visibleCalendars': [name: string]
	selectDate: [date: Date]
	selectEvent: [event: any]
}>()

const paletteColor = (color?: string) => (CalendarColorMap[color] || CalendarColorMap.green).color

const dotStyle = (color: string) => ({ background: paletteColor(color) })

// A JMAP calendar is often named after its account — "Frappe Calendar
// (akash@frappe.io)" — which never fits a sidebar row. The email moves to a
// tooltip; once there are several accounts the colour dot tells them apart.
const calendarLabel = (calendar: any) => {
	const match = /^(.*?)\s*\(([^()]*@[^()]*)\)$/.exec(calendar._name || '')
	return match ? { label: match[1], email: match[2] } : { label: calendar._name, email: '' }
}

// --- Upcoming events: what is left of today, like mail's sidebar shows ---

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

const eventColor = (event: any) => paletteColor(event.color)

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

const showSettings = ref(false)
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
				onClick: () => (showSettings.value = true),
			},
		],
	},
	{
		group: '',
		options: [
			{
				icon: User,
				label: __('Accounts'),
				submenu: user.data.accounts.map?.((a) => ({
					label: a._name,
					selected: a.id === store.accountId,
					onClick: () => router.push({ name: route.name, params: { ...route.params, accountId: a.id } }),
				})),
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
				<!-- Stays mounted through a collapse and folds in step with the
				     sidebar's 300ms width animation, like frappe-ui's own labels
				     (they animate w-0/opacity-0; height is our axis). A fixed width
				     — the expanded sidebar's inner 224px — keeps the seven columns
				     from reflowing while the width is mid-transition: the rail's
				     overflow clips the card instead. -->
				<div
					v-if="month != null && year != null"
					class="w-56 transition-all duration-300 ease-in-out"
					:class="
						isSidebarCollapsed ? 'mb-0 max-h-0 overflow-hidden opacity-0' : 'mb-3 mt-3 max-h-72 opacity-100'
					"
				>
					<MiniMonth
						:month
						:year
						:events="events || []"
						:selected="day != null ? new Date(year, month, day) : undefined"
						:view
						@select="(date) => emit('selectDate', date)"
					/>
				</div>
				<!-- Collapsed, frappe-ui swaps a section's label for a divider line. That
				     separates groups in mail's rail, but with a single section here it
				     is a stray line under the header — so the label goes with the width. -->
				<SidebarSection :label="isSidebarCollapsed ? undefined : __('Calendars')">
					<!-- A calendar that is switched off keeps its place but loses its colour. -->
					<SidebarItem
						v-for="calendar in calendars"
						:key="calendar.name"
						:label="calendar._name"
						:on-click="() => emit('update:visibleCalendars', calendar.name)"
					>
						<template #prefix>
							<!-- Fills the 16px icon box: a dot beside the label, a swatch the size
							     of an icon once the rail is all that is left. -->
							<span
								class="shrink-0 rounded-full transition-all"
								:class="[
									isSidebarCollapsed ? 'mx-0.5 size-3' : 'mx-1 size-2',
									!visibleCalendars.includes(calendar.name) && 'opacity-30',
								]"
								:style="dotStyle(calendar.color)"
							/>
						</template>
						<Tooltip :text="calendarLabel(calendar).email" side="right">
							<span
								class="truncate text-sm"
								:class="!visibleCalendars.includes(calendar.name) && 'text-ink-gray-4'"
							>
								{{ calendarLabel(calendar).label }}
							</span>
						</Tooltip>
					</SidebarItem>
				</SidebarSection>
			</div>
			<!-- Pinned under the scrolling body, as mail's sidebar keeps it. -->
			<div class="mt-auto p-2">
				<UpcomingEvents
					:events="upcoming"
					:is-collapsed="isSidebarCollapsed"
					:is-open
					:event-color
					@select="(event) => emit('selectEvent', event)"
				/>
				<SidebarCollapseToggle />
			</div>
		</div>
	</Sidebar>
	<SettingsModal v-model="showSettings" />
</template>
