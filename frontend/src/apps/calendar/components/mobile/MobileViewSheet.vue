<template>
	<!-- The view switcher, reached from the header's hamburger or a re-tap of the
	     Calendar tab — where mail's folder sheet is reached from its hamburger or a
	     re-tap of the Mail tab. Same sheet, same rows, same metrics: which list you
	     are looking at is the same question in both apps. -->
	<!-- Titled, as mail's folder sheet is: the two are the same sheet answering
	     the same question in the two apps, so one of them naming itself and the
	     other not is a difference with nothing behind it. -->
	<BottomSheet v-model:open="isViewSheetOpen" :title="__('View')">
		<!-- BottomSheet provides the scroll container; this div only pads the content,
		     including the home-indicator safe area. -->
		<div class="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
			<button
				v-for="view in MOBILE_VIEWS"
				:key="view"
				:class="sheetRowClass(view === currentView)"
				@click="select(view)"
			>
				<component
					:is="viewIcon(view)"
					class="text-ink-gray-6 h-[18px] w-[18px] shrink-0"
				/>
				<span class="flex-1 truncate text-left">{{ viewLabel(view) }}</span>
			</button>
		</div>
	</BottomSheet>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BottomSheet } from 'frappe-ui'

import { useViewSheet } from '@/apps/calendar/composables/useViewSheet'
import {
	MOBILE_VIEWS,
	routeDate,
	routeForView,
	viewForRoute,
	viewIcon,
	viewLabel,
} from '@/apps/calendar/utils/mobileView'
import { userStore } from '@/apps/calendar/stores/user'
import { sheetRowClass } from '@/components/mobile/mobileClasses'

import type { MobileView } from '@/apps/calendar/utils/mobileView'

const route = useRoute()
const router = useRouter()
const store = userStore()
const { isViewSheetOpen, closeViewSheet } = useViewSheet()

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
