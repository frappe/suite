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
					loading: save.loading,
					onClick: () => save.submit(),
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
					@keydown.enter="form.name.trim() && (isNew || isDirty) && save.submit()"
				/>
				<FormControl v-model="form.color" type="select" :label="__('Color')" :options="colorOptions">
					<template #item-prefix="{ item }">
						<span class="size-2.5 shrink-0 rounded-full" :style="{ background: eventColor(item.value) }" />
					</template>
				</FormControl>
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { Dialog, FormControl, createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/calendar/utils'
import { CALENDAR_COLORS } from '@/apps/calendar/utils/calendars'
import { eventColor } from '@/apps/calendar/utils/color'
import { userStore } from '@/apps/calendar/stores/user'

import type { CalendarRow } from '@/apps/calendar/utils/calendars'

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
	const palette = CALENDAR_COLORS.map(({ name, hex }) => ({ label: COLOR_LABELS()[name], value: hex }))
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
	const index = calendar ? calendars.findIndex((cal) => cal.name === calendar.name) : calendars.length
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
	store.calendars.reload()
}
const onError = (error) => raiseToast(error.messages?.[0] || error.message, 'error')

const createCalendar = createResource({
	url: 'suite.calendar.api.create_calendar',
	makeParams: () => ({ account: store.accountId, name: form.name, color: form.color }),
	onSuccess: () => onSaved(__('Calendar created.')),
	onError,
})

const editCalendar = createResource({
	url: 'suite.calendar.api.edit_calendar',
	makeParams: () => ({
		account: calendar!.account,
		id: calendar!.id,
		name: form.name,
		color: form.color,
	}),
	onSuccess: () => onSaved(__('Calendar updated.')),
	onError,
})

const save = computed(() => (isNew.value ? createCalendar : editCalendar))
</script>
