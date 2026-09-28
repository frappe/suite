<template>
	<!-- New event — the one thing the calendar is for that a tab cannot be. It floats
	     above the bar in the right thumb zone. It belongs to the calendar itself, so it
	     steps aside on the Profile page and while a sheet is up, which owns the bottom
	     edge then. Geometry, tint and label treatment are mail's tab bar's, shared: on a
	     phone the two apps are one product. -->
	<Button
		v-if="calendarActive && !searchActive && !sheetOpen && !showAppsSheet"
		variant="solid"
		class="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-10 !h-14 !w-14 !rounded-full shadow-lg"
		:aria-label="__('New event')"
		@click="openCreate"
	>
		<template #icon>
			<CalendarPlus class="h-6 w-6" />
		</template>
	</Button>

	<nav
		class="bg-surface-base/80 z-10 shrink-0 border-t pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_5px_rgba(0,0,0,0.03)] backdrop-blur-lg"
	>
		<div class="flex h-15 items-stretch">
			<!-- Tab 1 morphs into the view you are on, as mail's morphs into the
			     current folder: the fixed slot is the stable cue, icon and label say
			     where you are. Re-tap opens the switcher, again as mail's does. -->
			<button :class="tabClass(calendarActive)" @click="openCalendar">
				<component :is="viewIcon(currentView)" :class="iconClass(calendarActive)" />
				<span class="max-w-full truncate px-1" :class="labelClass(calendarActive)">
					{{ viewLabel(currentView) }}
				</span>
			</button>
			<!-- Search is a page of its own, not the palette raised over the calendar: a
			     result opens where it was found, and Back returns to the search rather
			     than to whichever view it was searched from. A tab rather than a button
			     in the header row, which mail can afford because its header is bare — the
			     calendar's already carries the date picker and three paging controls. -->
			<button :class="tabClass(searchActive)" @click="openSearch">
				<Search :class="iconClass(searchActive)" />
				<span :class="labelClass(searchActive)">{{ __('Search') }}</span>
			</button>
			<!-- Settings live behind the person, as the design has it: one tab for
			     everything about you and your calendars. The photo has no stroke to
			     thicken the way the other icons do, so selection draws a ring instead. -->
			<button :class="tabClass(profileActive)" @click="openProfile">
				<Avatar
					:label="user?.data?.full_name"
					:image="user?.data?.user_image"
					size="md"
					class="size-5.5 shrink-0"
					:class="profileActive && 'ring-[1.5px] ring-current'"
				/>
				<span :class="labelClass(profileActive)">{{ __('Profile') }}</span>
			</button>
			<!-- Bound so the new-event button steps aside while the apps sheet is up. -->
			<MobileAppTab v-model:open="showAppsSheet" app-id="calendar" />
		</div>
	</nav>

	<MobileViewSheet />
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Avatar, Button } from 'frappe-ui'
import { CalendarPlus, Search } from 'lucide-vue-next'

import { userStore } from '@/apps/calendar/stores/user'
import { useViewSheet } from '@/apps/calendar/composables/useViewSheet'
import MobileViewSheet from '@/apps/calendar/components/mobile/MobileViewSheet.vue'
import MobileAppTab from '@/components/mobile/MobileAppTab.vue'
import { iconClass, labelClass, tabClass } from '@/components/mobile/mobileClasses'
import { lastCalendarView } from '@/apps/calendar/utils/lastView'
import { routeForView, viewForRoute, viewIcon, viewLabel } from '@/apps/calendar/utils/mobileView'

const route = useRoute()
const router = useRouter()
const store = userStore()
const user = inject('$user') as { data?: Record<string, any> } | undefined
const { openViewSheet } = useViewSheet()

// What is layered over the calendar is in the URL already — the detail sheet is
// ?event=, the event modal is ?edit= or ?new= — so the bar can see it without the
// view having to tell it.
const sheetOpen = computed(
	() => !!route.query.event || !!route.query.edit || !!route.query.new,
)

const profileActive = computed(() => route.name === 'calendar-profile')
const searchActive = computed(() => route.name === 'calendar-search')

const showAppsSheet = ref(false)

// The URL is what says which view is up. Off the calendar — on Profile — there
// is no view in the URL to read, so the tab names the one a tap would land in,
// which is the one `calendarRoute` goes to. It said "Agenda" there whatever the
// calendar had been left in, and then opened the Day view.
const offCalendar = computed(() => profileActive.value || searchActive.value)
const currentView = computed(() =>
	offCalendar.value
		? viewForRoute(lastCalendarView() ?? routeForView('agenda'))
		: viewForRoute(route.name),
)
const calendarActive = computed(() => !offCalendar.value)

// Re-tapping Search while on it is nothing to do: the field is already there to type in.
const openSearch = () => {
	if (searchActive.value) return
	router.push({ name: 'calendar-search', params: { accountId: store.accountId } })
}

/**
 * Back to the calendar, in the view it was left in — Profile is a trip away from
 * the calendar, not a reason to be put back at its front door. The agenda is
 * home only when nothing is remembered. A date-less route means today.
 */
const calendarRoute = () => ({
	name: lastCalendarView() ?? routeForView('agenda'),
	params: { accountId: store.accountId },
})

// Re-tapping the Calendar tab opens the view switcher, as re-tapping mail's Mail
// tab opens the folder switcher: the tab you are already on offers the one thing
// left to do on that surface. Getting back to today is the header's Today button,
// which is there exactly when the view has wandered off it.
const openCalendar = () => {
	if (calendarActive.value) {
		openViewSheet()
		return
	}
	router.push(calendarRoute())
}

// Re-tapping Profile pops back to the root of its own stack: the open settings
// sub-page is a query on this route, so dropping the query closes it.
const openProfile = () => {
	if (profileActive.value) {
		if (route.query.tab) router.replace({ query: {} })
		return
	}
	router.push({ name: 'calendar-profile', params: { accountId: store.accountId } })
}

// Creating is a query the calendar view answers, the way mail's compose is a route:
// the bar stands outside the view that owns the event modal.
const openCreate = () => router.replace({ query: { ...route.query, new: '1' } })
</script>
