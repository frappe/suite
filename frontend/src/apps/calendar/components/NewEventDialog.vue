<script setup lang="ts">
/**
 * Calendar's new-event form over another area's page: the dialog on a desktop, the full-screen form
 * on a phone. It opens filled in from `draft`, saves and asks whether to email the guests just as it
 * does in Calendar, and leaves the page and its URL as they were. Once saved, the toast offers the
 * event in Calendar. Opened by `useNewEventDialog` through the platform's dialog host, which
 * resolves with the `saved` event.
 *
 * The form belongs to the page it was asked from (`from`, its full path): Back closes it, and so
 * does any move off that page, before or after the form has loaded.
 */
import { computed, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import EventModal from '@/apps/calendar/components/Modals/EventModal.vue'
import { useCalendarBody } from '@/apps/calendar/composables/useCalendarBody'
import { userStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import type { CreatedEvent, NewEventDraft } from '@/apps/calendar/utils/newEventDraft'
import { useHistoryEntry } from '@/platform/history-entry'
import { translate as __ } from '@/platform/translation'

const { draft, from } = defineProps<{ draft: NewEventDraft; from: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [event: CreatedEvent]; afterLeave: [] }>()

const store = userStore()
const route = useRoute()
const router = useRouter()

// The repeat settings in the form read Calendar's dayjs, which Calendar's layout gives its pages.
provide('$dayjs', dayjs)

// Shown only on the page it was asked from, so a form whose code or data came in after the reader
// moved on never shows at all.
const shown = computed({
  get: () => open.value && route.fullPath === from,
  set: (value) => (open.value = value),
})
watch(
  () => route.fullPath,
  (path) => {
    if (path !== from) open.value = false
  },
  { immediate: true },
)
useHistoryEntry(shown)
// A form closed before it ever showed has no closing transition to wait for.
let showed = false
watch(
  shown,
  (value) => {
    if (value) showed = true
    else if (!showed) emit('afterLeave')
  },
  { immediate: true },
)

// Calendar's route guard loads the account, identities and calendars the form reads. From another
// area none of it may have been asked for yet. The dialog or screen is up meanwhile, with the form
// in it once they have come: a form without its account has no calendars to offer and no one to
// look up as a guest.
const loading = ref(true)
void store.loadForEventForm().then(() => (loading.value = false))

// Held until the form has gone from the screen, not just been closed: the dialog teleports to
// <body>, and its icons would change weight as it fades.
useCalendarBody()

const selectedEvent = { date: new Date(), prefill: draft }

// The event's day in Calendar, with its card open, as an event reminder links to it.
const openInCalendar = ({ id, account, date }: CreatedEvent) => ({
  label: __('View in Calendar'),
  onClick: () =>
    void router.push({
      path: `/calendar/account/${encodeURIComponent(account)}/day/${dayjs(date).format('YYYY/M/D')}`,
      query: { event: id },
    }),
})
</script>

<template>
  <!-- The dialog host is not in the document; the phone's form is a fixed screen, not a portal. -->
  <Teleport to="body">
    <EventModal
      v-model="shown"
      :selected-event="selectedEvent"
      :loading="loading"
      :created-action="openInCalendar"
      ask-before-leaving
      @created="(event) => emit('saved', event)"
      @after-leave="emit('afterLeave')"
    />
  </Teleport>
</template>
