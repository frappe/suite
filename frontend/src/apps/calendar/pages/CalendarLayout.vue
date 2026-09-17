<script setup lang="ts">
import { onMounted, onScopeDispose, onUnmounted, provide, ref } from 'vue'
import { FrappeUIProvider } from 'frappe-ui'

import { useScreenSize } from '@/composables/useScreenSize'
import CalendarTabBar from '@/apps/calendar/components/mobile/CalendarTabBar.vue'

import dayjs from '@/apps/calendar/utils/dayjs'
import { userStore } from '@/apps/calendar/stores/user'
import { initSocket } from '@/apps/calendar/socket'
import SettingsModal from '@/apps/calendar/components/Modals/SettingsModal.vue'
import { useRootStore } from '@/stores/root'

/**
 * Calendar route-group layout.
 *
 * The suite shell already provides the top-level chrome, so this layout only:
 *   - provides the calendar-local `$user` (mail/calendar userResource), `$dayjs`
 *     and `$socket` injections that calendar components depend on,
 *   - wraps children in FrappeUIProvider and renders the nested <router-view>.
 */
const { isMobile } = useScreenSize()
const { userResource } = userStore()
const showSettings = ref(false)

provide('$user', userResource)
provide('$dayjs', dayjs)
provide('$socket', initSocket())
provide('openCalendarSettings', () => (showSettings.value = true))

const unregisterPaletteGroups = useRootStore().registerPaletteGroups('calendar-layout', [
	{
		commands: [
			{
				id: 'calendar-settings',
				label: 'Calendar settings',
				enterHint: 'open Calendar settings',
				icon: 'lucide-settings',
				run: () => (showSettings.value = true),
			},
		],
	},
])
onScopeDispose(unregisterPaletteGroups)

// Mark <body> while calendar is mounted so the `.icon` helper below (see <style>) can
// reach frappe-ui Dropdowns/Dialogs, which teleport to <body> — outside the calendar tree.
onMounted(() => {
	document.body.classList.add('calendar-app')
})
onUnmounted(() => {
	document.body.classList.remove('calendar-app')
})
</script>

<template>
	<FrappeUIProvider>
		<!-- The phone's chrome stands outside the routes so it is the same bar on the
		     calendar and on Profile, and so a route change never remounts it. The height
		     is owned here for the same reason: the views fill what is left above the bar
		     rather than each measuring the viewport themselves. -->
		<div v-if="isMobile" class="flex h-dvh min-h-0 flex-col pt-[env(safe-area-inset-top)]">
			<div class="min-h-0 flex-1"><router-view /></div>
			<CalendarTabBar />
		</div>
		<router-view v-else />
		<SettingsModal v-model="showSettings" />
	</FrappeUIProvider>
</template>

<style>
/* Lucide icons render an <svg> whose default stroke-width is 2, and Tailwind has no
   `stroke-1.5` utility, so give the calendar a shared `.icon` helper for the 1.5 stroke —
   mirrors the mail layout. Scoped to `body.calendar-app` (toggled while this layout is
   mounted) so it also reaches Dropdowns/Dialogs that teleport to <body>, and never leaks
   into the other suite apps. */
body.calendar-app .icon {
	stroke-width: 1.5;
}

/* Icons imported straight from lucide-vue-next ship stroke-width 2, and menu
   item icons (frappe-ui Dropdown/Menu) render without the `.icon` class — so
   default every lucide svg to 1.5, mirroring the mail layout. :where() keeps
   the rule at zero specificity so an explicit stroke-* utility still wins.
   Covers teleported menus/dialogs too. */
:where(body.calendar-app svg.lucide) {
	stroke-width: 1.5;
}
</style>
