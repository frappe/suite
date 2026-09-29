<template>
	<!-- The advanced filters, in the palette rather than beside it: the query line above stays
	     where it was, and every field here writes the same filters the badges show. It takes
	     the result list's place while it is open — a form and the results it has not run yet
	     are two answers to the same question.

	     Each field names the badge it belongs to, so clicking a badge can land the cursor in
	     the one it stands for. -->
	<div ref="panel" class="min-h-0 flex-1 overflow-y-auto">
		<div class="space-y-4 p-4">
			<!-- The dot the event form puts beside a calendar, for the same reason: the colour
			     is how the reader knows that calendar on the grid. "All calendars" stands for
			     no one calendar, so it gets no dot. -->
			<!-- frappe-ui's Select rather than a native one: it is a popover this can open on
			     demand, where a `<select>` only opens from a real click on itself. `showPicker`
			     reaches a native one in Chrome 121 and nowhere else, and a reader who clicked a
			     badge to change a calendar has already asked for the list. -->
			<div data-field="calendar">
				<Select
					v-model="filter.calendar"
					v-model:open="calendarOpen"
					:label="__('Look In')"
					:options="calendarSelectOptions"
				>
					<template #item-prefix="{ item }">
						<span
							v-if="item.color"
							class="size-2.5 shrink-0 rounded-full"
							:style="{ background: eventColor(item.color) }"
						/>
					</template>
				</Select>
			</div>
			<div data-field="organizer">
				<ContactCombobox
					v-model="filter.organizer"
					:account="account"
					:label="__('Organiser')"
				/>
			</div>
			<div data-field="attendee">
				<ContactCombobox
					v-model="filter.attendee"
					:account="account"
					:label="__('Attendee')"
				/>
			</div>
			<!-- Pickers of the library's own, as the calendar above is: each is a popover a
			     badge can open, where a native date input opens only from a click on itself. -->
			<div class="flex space-x-4">
				<div data-field="after" class="w-full">
					<DatePicker
						v-model="filter.after"
						v-model:open="afterOpen"
						:label="__('From Date')"
						:placeholder="__('Any date')"
						class="w-full"
					/>
				</div>
				<div data-field="before" class="w-full">
					<DatePicker
						v-model="filter.before"
						v-model:open="beforeOpen"
						:label="__('To Date')"
						:placeholder="__('Any date')"
						class="w-full"
					/>
				</div>
			</div>
			<p class="text-p-xs text-ink-gray-5">
				{{
					__(
						'A date range finds the occurrence in it, rather than the series it belongs to — so picking one end fills the other.',
					)
				}}
			</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { DatePicker, Select } from 'frappe-ui'

import { eventColor } from '@/apps/calendar/utils/color'

import ContactCombobox from '@/apps/mail/components/Controls/ContactCombobox.vue'
import type { CalendarSearchFilter } from '@/apps/calendar/composables/useCalendarSearchFilters'

const props = defineProps<{
	filter: CalendarSearchFilter
	account: string
	/**
	 * Which field to put the cursor in, named by the badge that sent the reader here. Found by
	 * attribute rather than by a ref each: the controls are a native select, two comboboxes and
	 * two date inputs, and only the DOM knows what to focus in each.
	 */
	focusField?: string
	/** The reader's calendars and those shared with them, as `userStore` lists them. */
	calendarOptions: {
		label: string
		value: string
		description?: string
		color?: string
	}[]
}>()

const panel = ref<HTMLElement | null>(null)

/**
 * The three fields that are a popover rather than a plain input, so a badge can open the one
 * it stands for. The other two are comboboxes, where typing is the opening and the focus is
 * the whole of it.
 */
const popovers: Record<string, Ref<boolean>> = {
	calendar: ref(false),
	after: ref(false),
	before: ref(false),
}
const calendarOpen = popovers.calendar
const afterOpen = popovers.after
const beforeOpen = popovers.before

watch(
	() => props.focusField,
	async (field) => {
		if (!field) return
		await nextTick()
		const popover = popovers[field]
		if (popover) {
			popover.value = true
			return
		}
		panel.value
			?.querySelector<HTMLElement>(`[data-field="${field}"] input`)
			?.focus()
	},
	{ immediate: true },
)

const calendarSelectOptions = computed(() => [
	{ label: __('All calendars'), value: '' },
	...props.calendarOptions.map((option) => ({
		// A calendar shared from another account says whose it is, the way the sidebar does.
		label: option.description ? `${option.label} · ${option.description}` : option.label,
		value: option.value,
		color: option.color,
	})),
])
</script>
