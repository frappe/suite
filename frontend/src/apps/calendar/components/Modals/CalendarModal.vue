<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: isNew ? __('New Calendar') : __('Edit Calendar'),
      actions: [
        {
          label: __('Save'),
          variant: 'solid',
          disabled: !form.name.trim() || (!isNew && !isDirty),
          loading: savePending,
          onClick: () => save().catch(() => {}),
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="form.name"
          :label="__('Name')"
          :placeholder="__('Personal')"
          autofocus
          required
          @keydown.enter="form.name.trim() && (isNew || isDirty) && save().catch(() => {})"
        />
        <FormControl
          v-model="form.color"
          type="select"
          :label="__('Color')"
          :options="colorOptions"
        >
          <template #item-prefix="{ item }">
            <span
              class="size-2.5 shrink-0 rounded-full"
              :style="{ background: eventColor(item.value) }"
            />
          </template>
        </FormControl>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { computed, reactive, watch } from 'vue'

import { api, useMutation } from '@/api'
import { userStore } from '@/apps/calendar/stores/user'
import { raiseToast } from '@/apps/calendar/utils'
import { CALENDAR_COLORS, type CalendarRow } from '@/apps/calendar/utils/calendars'
import { eventColor } from '@/apps/calendar/utils/color'

const show = defineModel<boolean>()

/** The calendar to edit; none to create one. */
const { calendar } = defineProps<{ calendar?: CalendarRow }>()

const store = userStore()

const isNew = computed(() => !calendar)

const form = reactive({ name: '', color: '' })

const COLOR_LABELS = (): Record<string, string> => ({
  blue: __('Blue'),
  green: __('Green'),
  violet: __('Violet'),
  amber: __('Amber'),
  pink: __('Pink'),
  cyan: __('Cyan'),
  orange: __('Orange'),
})

// A colour set in another client is kept as it is, and offered back as itself.
const colorOptions = computed(() => {
  const palette = CALENDAR_COLORS.map(({ name, hex }) => ({
    label: COLOR_LABELS()[name],
    value: hex,
  }))
  const own = calendar?.color
  return own && !palette.some((option) => option.value === own.toLowerCase())
    ? [...palette, { label: __('Custom'), value: own }]
    : palette
})

// The list colours an uncoloured calendar by position, so the form starts on that colour
// rather than on one the calendar does not wear. A new calendar's position is the end.
const startingColor = () => {
  if (calendar?.color) return calendar.color
  const calendars = store.calendars.data ?? []
  const index = calendar
    ? calendars.findIndex((cal) => cal.name === calendar.name)
    : calendars.length
  return CALENDAR_COLORS[Math.max(index, 0) % CALENDAR_COLORS.length].hex
}

watch(show, (open) => {
  if (!open) return
  form.name = calendar?._name ?? ''
  form.color = startingColor()
})

const isDirty = computed(
  () => form.name.trim() !== calendar?._name || form.color !== startingColor(),
)

const onSaved = (message: string) => {
  raiseToast(message)
  show.value = false
  store.calendars.refetch().catch(() => {})
}
const createCalendar = useMutation(api.calendar.calendars.create)
const editCalendar = useMutation(api.calendar.calendars.update)
const savePending = computed(() => createCalendar.isPending || editCalendar.isPending)
const save = async () => {
  if (isNew.value) {
    await createCalendar.run({ account: store.accountId, name: form.name, color: form.color })
    onSaved(__('Calendar created.'))
  } else if (calendar) {
    await editCalendar.run({
      account: calendar.account,
      id: calendar.id,
      name: form.name,
      color: form.color,
    })
    onSaved(__('Calendar updated.'))
  }
}
</script>
