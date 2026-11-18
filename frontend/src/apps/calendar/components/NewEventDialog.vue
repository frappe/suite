<script setup lang="ts">
/**
 * Calendar's new-event form over another area's page: the dialog on a desktop, the full-screen form
 * on a phone. It opens filled in from `draft`, saves and asks whether to email the guests just as it
 * does in Calendar, and leaves the page and its URL as they were. Once saved, the toast offers the
 * event in Calendar. Opened by function call (see newEventDialog.ts), never rendered by the caller.
 */
import { computed, provide, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'

import EventModal from '@/apps/calendar/components/Modals/EventModal.vue'
import { useCalendarBody } from '@/apps/calendar/composables/useCalendarBody'
import { userStore } from '@/apps/calendar/stores/user'
import dayjs from '@/apps/calendar/utils/dayjs'
import type { CreatedEvent, NewEventDraft } from '@/apps/calendar/utils/newEventDraft'
import { translate as __ } from '@/platform/translation'

const draft = defineModel<NewEventDraft | null>({ required: true })

const store = userStore()
const router = useRouter()

// What Calendar's layout gives its pages, given here: this form opens outside it.
provide('$user', store.userResource)
provide('$dayjs', dayjs)

// Calendar's route guard loads the account, identities and calendars the form reads. From another
// area none of it may have been asked for yet, so each draft waits for them before the form opens:
// a form opened without its account has no calendars to offer and no one to look up as a guest.
const loaded = ref(false)
// The last draft asked for, kept while the form fades out after closing.
const shown = shallowRef<NewEventDraft | null>(null)
watch(
  draft,
  async (asked) => {
    if (!asked) return
    loaded.value = false
    shown.value = asked
    await store.loadForEventForm()
    loaded.value = true
  },
  { immediate: true },
)

const open = computed({
  get: () => loaded.value && !!draft.value,
  set: (value) => {
    if (!value) draft.value = null
  },
})
useCalendarBody(() => open.value)
const selectedEvent = computed(() => ({ date: new Date(), prefill: shown.value ?? undefined }))

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
  <EventModal
    v-model="open"
    :selected-event="selectedEvent"
    :created-action="openInCalendar"
    ask-before-leaving
  />
</template>
