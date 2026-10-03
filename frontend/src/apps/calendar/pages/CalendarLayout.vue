<script setup lang="ts">
import { Button, useKeyboardShortcut } from 'frappe-ui'
import { CalendarPlus } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ShortcutsModal from '@/apps/calendar/components/Modals/ShortcutsModal.vue'
import { useShortcuts } from '@/apps/calendar/composables/useShortcuts'
import { useCalendarSocket } from '@/apps/calendar/socket'
import { userStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import { useScreenSize } from '@/composables/useScreenSize'

/**
 * Calendar route-group layout.
 *
 * The suite shell already provides the top-level chrome, and the platform provides the one
 * FrappeUIProvider, so this layout only:
 *   - provides the calendar-local `$user` (mail/calendar userResource) and `$dayjs`
 *     injections that calendar components depend on,
 *   - holds Calendar's site socket while mounted, which also starts the event
 *     reminders (`@/realtime`),
 *   - registers the app-wide shortcuts and the dialog that lists them,
 *   - on a phone, draws the new-event button above the shell's bottom nav,
 *   - renders the nested <router-view>.
 */
const { isMobile } = useScreenSize()
const { userResource } = userStore()
const { showShortcuts } = useShortcuts()
const route = useRoute()
const router = useRouter()

provide('$user', userResource)
provide('$dayjs', dayjs)
useCalendarSocket()

// Mark <body> while calendar is mounted so the `.icon` helper below (see <style>) can
// reach frappe-ui Dropdowns/Dialogs, which teleport to <body> — outside the calendar tree.
onMounted(() => document.body.classList.add('calendar-app'))
onUnmounted(() => document.body.classList.remove('calendar-app'))

useKeyboardShortcut({
  combo: 'Shift+Slash',
  description: __('View Shortcuts'),
  group: __('Other'),
  enabled: () => !isMobile.value,
  allowInDialog: true,
  handler: () => (showShortcuts.value = !showShortcuts.value),
})

// New event — the one thing the calendar is for that the bottom nav cannot be. It
// belongs to the calendar itself, so it steps aside on Search and Profile, and
// while a sheet is up, which owns the bottom edge then. What is layered over the
// calendar is in the URL already — the detail sheet is ?event=, the event form
// is ?edit= or ?new= — so this reads it without the view having to tell it.
const showNewEventButton = computed(
  () =>
    route.name !== 'calendar-search' &&
    route.name !== 'calendar-profile' &&
    !route.query.event &&
    !route.query.edit &&
    !route.query.new,
)

// Creating is a query the calendar view answers, the way mail's compose is a route.
const openCreate = () => router.replace({ query: { ...route.query, new: '1' } })
</script>

<template>
  <!-- The shell owns the height and the phone's chrome; the views fill the box
	     it hands them. -->
  <div v-if="isMobile" class="flex h-full min-h-0 flex-col">
    <div class="min-h-0 flex-1"><router-view /></div>
    <Button
      v-if="showNewEventButton"
      variant="solid"
      class="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-10 !h-14 !w-14 !rounded-full shadow-lg"
      :aria-label="__('New event')"
      @click="openCreate"
    >
      <template #icon>
        <CalendarPlus class="h-6 w-6" />
      </template>
    </Button>
  </div>
  <router-view v-else />
  <ShortcutsModal v-model:open="showShortcuts" />
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
