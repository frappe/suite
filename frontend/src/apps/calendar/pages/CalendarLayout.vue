<script setup lang="ts">
import { onMounted, onUnmounted, provide } from 'vue'
import { FrappeUIProvider } from 'frappe-ui'

import { shouldIgnoreKeypress } from '@/apps/calendar/utils'
import dayjs from '@/apps/calendar/utils/dayjs'
import { useTheme } from '@/apps/calendar/utils/composables'
import { userStore } from '@/apps/calendar/stores/user'
import { initSocket } from '@/apps/calendar/socket'

/**
 * Calendar route-group layout.
 *
 * The suite shell already provides the top-level chrome, so this layout only:
 *   - provides the calendar-local `$user` (mail/calendar userResource), `$dayjs`
 *     and `$socket` injections that calendar components depend on,
 *   - ports the Cmd/Ctrl+Shift+L theme-cycle shortcut,
 *   - wraps children in FrappeUIProvider and renders the nested <router-view>.
 */
const { userResource } = userStore()
const { cycleTheme } = useTheme()

provide('$user', userResource)
provide('$dayjs', dayjs)
provide('$socket', initSocket())

// Mark <body> while calendar is mounted so the `.icon` helper below (see <style>) can
// reach frappe-ui Dropdowns/Dialogs, which teleport to <body> — outside the calendar tree.
onMounted(() => {
	document.body.classList.add('calendar-app')
	window.addEventListener('keydown', handleKeyDown)
})
onUnmounted(() => {
	document.body.classList.remove('calendar-app')
	window.removeEventListener('keydown', handleKeyDown)
})

const handleKeyDown = (e: KeyboardEvent) => {
	const key = e.key.toLowerCase()

	// Handle Ctrl/Cmd+Shift+L (Cycle Theme)
	if ((e.metaKey || e.ctrlKey) && e.shiftKey && key === 'l' && !shouldIgnoreKeypress(e, true)) {
		e.preventDefault()
		return cycleTheme()
	}
}
</script>

<template>
	<FrappeUIProvider>
		<router-view />
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
