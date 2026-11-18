<template>
  <!-- The shell owns the height and, on a phone, the safe area above its header
	     target. While a thread is open the page owns the phone chrome instead
	     (`phoneChrome: 'page'`), so it pads for the status bar itself. -->
  <div
    v-if="userResource?.data?.name"
    class="relative flex h-full min-h-0 flex-col"
    :class="{ 'pt-[env(safe-area-inset-top)]': isMobile && !shellChrome }"
  >
    <AppSidebar />
    <div class="isolate flex min-h-0 flex-1 text-base">
      <div
        id="scrollContainer"
        class="w-full overflow-auto max-sm:flex max-sm:flex-col max-sm:overflow-hidden"
      >
        <slot />
      </div>
      <!-- The event picked from a message's invite strip, as a card hung on
			     what was clicked — the calendar app's own card, hosted here so the
			     event opens without leaving mail. Desktop only; mobile navigates to the calendar instead. -->
      <EventPopover
        :open="!!selectedEvent && !!cardAnchor && !isMobile"
        :anchor="cardAnchor?.element ?? null"
        :side="cardAnchor?.side ?? 'right'"
        @close="selectedEvent = null"
      >
        <EventDetail
          v-if="selectedEvent"
          :key="selectedEvent.id + (selectedEvent.recurrence_id ?? '')"
          variant="popover"
          :calendar-event="selectedEvent"
          @close="selectedEvent = null"
          @edit="openEventInCalendar"
          @email-participants="emailEventParticipants"
        />
      </EventPopover>
      <!-- Mail's composer: the window over the page on a desktop, the compose page on a phone. -->
      <ComposeHost />
    </div>

    <!-- Compose, floating above the shell's bottom nav in the right thumb zone.
		     It steps aside with the nav while a thread is open, and in the lists
		     where composing is not the task: search results, selection mode, the
		     screener and the profile page. -->
    <Button
      v-if="isMobile && showComposeButton"
      variant="solid"
      class="fixed bottom-[calc(var(--suite-phone-nav-height,4rem+env(safe-area-inset-bottom))+1rem)] right-4 z-10 !h-14 !w-14 !rounded-full shadow-lg"
      :aria-label="__('Compose')"
      @click="openComposePage(router, store.accountId)"
    >
      <template #icon>
        <span class="lucide-square-pen size-6" aria-hidden="true" />
      </template>
    </Button>
  </div>
</template>
<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed, provide, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import EventDetail from '@/apps/calendar/components/EventDetail.vue'
import EventPopover from '@/apps/calendar/components/EventPopover.vue'
import dayjs from '@/apps/calendar/utils/dayjs'
import AppSidebar from '@/apps/mail/components/AppSidebar.vue'
import ComposeHost from '@/apps/mail/components/ComposeHost.vue'
import { openComposePage } from '@/apps/mail/composables/composeHandoff'
import { eventDayRoute, useUpcomingEvents } from '@/apps/mail/composables/useUpcomingEvents'
import { userStore } from '@/apps/mail/stores/user'
import {
  useComposeMail,
  useDiscardingDrafts,
  useKeyboardOpen,
  useListReload,
  useMobileSearch,
  useMobileSelection,
  useScreenSize,
} from '@/apps/mail/utils/composables'
import { resumeRemovals } from '@/apps/mail/utils/pendingRemovals'
import { useShellPhoneChrome } from '@/platform/phone-chrome'

const store = userStore()
const { userResource } = store

const { isMobile } = useScreenSize()
const { requestListReload } = useListReload()
const { holdDraft, releaseDraft } = useDiscardingDrafts()
// Removals a closed page left inside their Undo window: the window is over, so they go now.
void resumeRemovals(requestListReload, { hold: holdDraft, release: releaseDraft })

const router = useRouter()
const route = useRoute()
const { selectedEvent, cardAnchor } = useUpcomingEvents()

// ── The phone's chrome ────────────────────────────────────────────────────────────────────────────
// The shell's bottom nav belongs under the lists. An open thread is full screen: its own reply
// actions take the bottom edge. The on-screen keyboard shrinks the shell, which would push the
// nav up onto the keyboard (worst in search, where the field is focused the whole time), so the
// nav steps aside for it too.
const isThreadOpen = computed(() => !!route.params.threadID)
const keyboardOpen = useKeyboardOpen()
const shellChrome = computed(() => isMobile.value && !isThreadOpen.value && !keyboardOpen.value)
useShellPhoneChrome(shellChrome)

const { isSearchRoute, paletteOpen } = useMobileSearch()
const { isMobileSelectionActive } = useMobileSelection()
const showComposeButton = computed(
  () =>
    shellChrome.value &&
    !isMobileSelectionActive.value &&
    !isSearchRoute.value &&
    !paletteOpen.value &&
    route.name !== 'mail-profile',
)

// Leaving the search route (Back, or a folder chosen in the sheet) closes the palette it was
// raised behind.
watch(isSearchRoute, (active) => {
  if (!active) paletteOpen.value = false
})

// EventDetail is a calendar component and expects the calendar layout's
// $dayjs injection (the instance with duration/tz/utc plugins installed).
provide('$dayjs', dayjs)

// Full editing (participants, recurrence) lives in the calendar app's modal;
// hand over via its deep link (?edit=<id>) so the modal is already open on
// arrival — the modal alone, not the detail card the day route would open.
// Clear the selection so the sidebar isn't still open when the user comes
// back to mail.
const openEventInCalendar = () => {
  const target = eventDayRoute(selectedEvent.value, store.accountId)
  selectedEvent.value = null
  const { event, recurrence, ...query } = target.query
  router.push({ ...target, query: { ...query, edit: event, editRecurrence: recurrence } })
}

// From the event's popover: writing to everyone is where attention goes next, so the popover
// steps aside rather than sitting over the page beside the composer.
const { requestCompose } = useComposeMail()
const emailEventParticipants = (emails: string[]) => {
  selectedEvent.value = null
  requestCompose({ to: emails.map((email) => ({ email })) })
}

// Compose deep link (?compose=1&to=a,b): how other apps (calendar's "email
// participants") open mail's compose window. Consumed on arrival — the query
// is cleared so reload/back don't reopen the draft.
watch(
  () => route.query.compose,
  (compose) => {
    if (!compose) return
    const to = String(route.query.to || '')
      .split(',')
      .filter(Boolean)
    requestCompose({ to: to.map((email) => ({ email })) })
    const { compose: _compose, to: _to, ...query } = route.query
    router.replace({ query })
  },
  { immediate: true },
)
</script>
