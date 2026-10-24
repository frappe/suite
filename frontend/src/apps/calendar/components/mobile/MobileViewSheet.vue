<template>
	<!-- The view switcher, reached from the header's hamburger or a re-tap of the
	     Calendar tab — where mail's folder sheet is reached from its hamburger or a
	     re-tap of the Mail tab. Untitled: four tiles read as the views without a heading
	     saying so, and the calendars beneath carry group headings of their own. -->
	<BottomSheet v-model:open="isViewSheetOpen">
		<!-- BottomSheet provides the scroll container; this div only pads the content,
		     including the home-indicator safe area. -->
		<div class="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
			<!-- The views as a row of tiles, the launcher's shape: a glyph in a square and the
			     name beneath, the square tinted for the one you are on. -->
			<div class="grid grid-cols-4 gap-2 pt-1">
				<button
					v-for="view in MOBILE_VIEWS"
					:key="view"
					:class="sheetTileClass(view === currentView)"
					:aria-current="view === currentView ? 'true' : undefined"
					@click="select(view)"
				>
					<span :class="sheetTileBoxClass(view === currentView)">
						<component :is="viewIcon(view)" :class="iconClass(view === currentView)" />
					</span>
					<span :class="sheetTileLabelClass(view === currentView)">
						{{ viewLabel(view) }}
					</span>
				</button>
			</div>

			<!-- A rule across the sheet between the two: the tiles are one question and the list
			     another, and the group heading beneath it starts the list. -->
			<div class="-mx-3 mt-3 border-t" />

			<!-- The calendars, beneath the views, grouped as the sidebar groups them: a phone has
			     no sidebar, and this sheet is where it asks what it is looking at. A tap switches
			     a calendar on or off and leaves the sheet up, since one tap is rarely the last —
			     the dot dims and the name greys, as the sidebar's row does. -->
			<template v-for="group in calendarGroups" :key="group.key">
				<div class="text-ink-gray-5 px-3 pb-1 pt-3 text-sm">{{ group.label }}</div>
				<button
					v-for="calendar in group.calendars"
					:key="calendar.name"
					:class="sheetRowClass(false)"
					:aria-pressed="!!calendar.visible"
					@click="toggleVisible(calendar)"
				>
					<span class="grid h-[18px] w-[18px] shrink-0 place-items-center">
						<span
							class="size-2.5 rounded-full transition-opacity"
							:class="!calendar.visible && 'opacity-30'"
							:style="{ background: dotColor(calendar.name) }"
						/>
					</span>
					<span
						class="flex-1 truncate text-left"
						:class="!calendar.visible && 'text-ink-gray-4'"
					>
						{{ calendarLabel(calendar._name).label }}
					</span>
				</button>
			</template>
		</div>
	</BottomSheet>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BottomSheet } from 'frappe-ui'

import { storeToRefs } from 'pinia'

import { useCalendarActions } from '@/apps/calendar/composables/useCalendarActions'
import { useViewSheet } from '@/apps/calendar/composables/useViewSheet'
import { calendarColor, calendarLabel } from '@/apps/calendar/utils/calendars'
import { eventColor } from '@/apps/calendar/utils/color'
import {
	MOBILE_VIEWS,
	routeDate,
	routeForView,
	viewForRoute,
	viewIcon,
	viewLabel,
} from '@/apps/calendar/utils/mobileView'
import { userStore } from '@/apps/calendar/stores/user'
import {
	iconClass,
	sheetRowClass,
	sheetTileBoxClass,
	sheetTileClass,
	sheetTileLabelClass,
} from '@/components/mobile/mobileClasses'

import type { MobileView } from '@/apps/calendar/utils/mobileView'

const route = useRoute()
const router = useRouter()
const store = userStore()
const { calendarGroups } = storeToRefs(store)
const { isViewSheetOpen, closeViewSheet } = useViewSheet()
const { toggleVisible } = useCalendarActions()

// The rows, not the resource that holds them: the palette colour is by position in the list.
const dotColor = (name: string) => eventColor(calendarColor(store.calendars.data, name))

const currentView = computed<MobileView>(() => viewForRoute(route.name))

// The URL is the source of truth for the view, so switching is a navigation, not
// a flag handed to the view — and Back retraces it, as it does on the desktop.
// The day stays put: the month you open is the one the agenda was on.
const select = (view: MobileView) => {
	closeViewSheet()
	if (view === currentView.value) return

	const day = routeDate(route.params)
	router.push({
		name: routeForView(view),
		params: {
			accountId: store.accountId,
			year: String(day.year()),
			month: String(day.month() + 1),
			day: String(day.date()),
		},
		query: route.query,
	})
}
</script>
