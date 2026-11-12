<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Delete {0}?', [calendar?._name ?? '']),
      message: __('Every event on this calendar will be deleted too. This can\'t be undone.'),
      icon: 'lucide-trash-2',
      theme: 'red',
      actions: [
        {
          label: __('Delete'),
          variant: 'solid',
          theme: 'red',
          loading: deleteCalendar.isPending,
          onClick: () => deleteCalendarSubmit(),
        },
      ],
    }"
  />
</template>

<script setup lang="ts">
import { Dialog } from 'frappe-ui'

import { api, useMutation } from '@/api'
import { raiseToast } from '@/apps/calendar/utils'
import type { CalendarRow } from '@/apps/calendar/utils/calendars'

const show = defineModel<boolean>()

const { calendar } = defineProps<{ calendar?: CalendarRow }>()

const deleteCalendar = useMutation(api.calendar.calendars.delete)
async function deleteCalendarSubmit() {
  if (!calendar) return
  await deleteCalendar.run({ account: calendar.account, id: calendar.id })
  raiseToast(__('Calendar deleted.'))
  show.value = false
}
</script>
