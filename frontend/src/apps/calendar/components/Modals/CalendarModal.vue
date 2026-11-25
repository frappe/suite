<template>
  <AdaptiveDialog
    v-model:open="show"
    v-bind="{
      title: isNew ? __('New Calendar') : __('Edit Calendar'),
      actions,
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
          :error="saveError"
          @keydown.enter="form.name.trim() && (isNew || isDirty) && save()"
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
        <FormControl
          v-if="canBeDefault"
          v-model="form.default"
          type="checkbox"
          :label="__('Set as default calendar')"
        />
      </div>
    </template>
  </AdaptiveDialog>
</template>

<script setup lang="ts">
import { FormControl, type DialogAction } from 'frappe-ui'
import { computed, reactive, watch } from 'vue'

import { api, useMutation } from '@/api'
import { userStore } from '@/apps/calendar/stores/user'
import { raiseToast } from '@/apps/calendar/utils'
import {
  CALENDAR_COLORS,
  isDeletableCalendar,
  type CalendarRow,
} from '@/apps/calendar/utils/calendars'
import { eventColor } from '@/apps/calendar/utils/color'
import { failureLine } from '@/platform/feedback'
import AdaptiveDialog from '@/platform/feedback/AdaptiveDialog.vue'
import { translate as __ } from '@/platform/translation'

const show = defineModel<boolean>()

/** The calendar to edit; none to create one. */
const { calendar } = defineProps<{ calendar?: CalendarRow }>()
const emit = defineEmits<{
  /** Delete was pressed on the calendar being edited. The caller asks whether that is meant. */
  delete: []
}>()

const store = userStore()

const isNew = computed(() => !calendar)

const form = reactive({ name: '', color: '', default: false })

// The default stays the default until another calendar takes over, so it has nothing to tick
const canBeDefault = computed(() => !!calendar && !calendar.default)

const COLOR_LABELS = () =>
  new Map<string, string>(
    Object.entries({
      blue: __('Blue'),
      green: __('Green'),
      violet: __('Violet'),
      amber: __('Amber'),
      pink: __('Pink'),
      cyan: __('Cyan'),
      orange: __('Orange'),
    }),
  )

// A colour set in another client is kept as it is, and offered back as itself.
const colorOptions = computed(() => {
  const palette = CALENDAR_COLORS.map(({ name, hex }) => ({
    label: COLOR_LABELS().get(name),
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

  // What the last visit was refused is not said on this one
  createCalendar.reset()
  editCalendar.reset()
  form.name = calendar?._name ?? ''
  form.color = startingColor()
  form.default = false
})

const isDirty = computed(
  () => form.name.trim() !== calendar?._name || form.color !== startingColor() || form.default,
)
const isSaveBlocked = computed(() => !form.name.trim() || (!isNew.value && !isDirty.value))

const onSaved = (message: string) => {
  raiseToast(message)
  show.value = false
  store.calendars.refetch().catch(() => {})
}

// A refused save is said under the name, where the eyes are, so no toast says it too
const createCalendar = useMutation(api.calendar.calendars.create, { silent: true })
const editCalendar = useMutation(api.calendar.calendars.update, { silent: true })
const saveError = computed(() => failureLine(createCalendar.error ?? editCalendar.error))
const savePending = computed(() => createCalendar.isPending || editCalendar.isPending)
const save = async () => {
  if (isNew.value) {
    await createCalendar.run({ account: store.accountId, name: form.name, color: form.color })
    onSaved(__('Calendar created'))
  } else if (calendar) {
    await editCalendar.run({
      account: calendar.account,
      id: calendar.id,
      name: form.name,
      color: form.color,
      default: form.default,
    })
    onSaved(__('Calendar updated'))
  }
}

const actions = computed(() => {
  const saveAction: DialogAction = {
    label: __('Save'),
    variant: 'solid',
    disabled: isSaveBlocked.value,
    loading: savePending.value,
    onClick: () => save(),
  }
  if (!calendar || !isDeletableCalendar(calendar)) {
    return [saveAction]
  }

  // Set apart at the start of the row, as Delete is on every form in Settings
  const deleteAction: DialogAction & { class: string } = {
    label: __('Delete'),
    theme: 'red',
    class: 'me-auto',
    onClick: () => emit('delete'),
  }

  return [deleteAction, saveAction]
})
</script>
