<template>
	<!-- The phone's search: a page of its own where the calendar would be, not the palette
	     raised over it. The view owns the results and the sheet; this owns the asking — the
	     field, the filters, and the list — and hands a tap on a row back up, so a result
	     opens where it was found rather than by leaving for a view. -->
	<div class="flex min-h-0 flex-1 flex-col">
		<!-- The same 56px row the calendar's own header keeps, so the two pages sit level. -->
		<div class="flex h-14 shrink-0 items-center gap-2 border-b border-outline-gray-1 px-3">
			<span class="lucide-search size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
			<input
				ref="field"
				v-model="text"
				type="search"
				enterkeyhint="search"
				autocomplete="off"
				:placeholder="__('Search')"
				:aria-label="__('Search events')"
				class="min-w-0 flex-1 self-stretch border-none bg-transparent text-base text-ink-gray-8 placeholder-ink-gray-4 focus:ring-0"
				@focus="showFilters = false"
			/>
			<Button
				:variant="showFilters ? 'subtle' : 'ghost'"
				icon="lucide-sliders-horizontal"
				size="sm"
				:aria-label="__('Filters')"
				:aria-expanded="showFilters"
				@click="toggleFilters"
			/>
		</div>

		<!-- What is narrowed, as the palette draws it, since it is the same filter. -->
		<CalendarFilterBadges
			v-if="!showFilters"
			:badges="badges"
			clear-as-word
			@edit="editFilter"
			@remove="(key) => emit('removeFilter', key)"
			@clear="emit('clearFilters')"
		/>

		<!-- The panel takes the list's place while it is open: a form and the results it has
		     not run yet are two answers to the same question. -->
		<CalendarFilterPanel
			v-if="showFilters"
			:filter="filter"
			:account="account"
			:calendar-options="calendarOptions"
			:focus-field="fieldToFocus"
		/>

		<div v-else class="min-h-0 flex-1 overflow-y-auto">
			<!-- The palette's own empty state, to the class and the words — frappe-ui's
			     CommandPaletteEmpty draws it, but only inside a palette, which this page is
			     not. The region is mounted whether or not it holds a message, for the reason
			     the library gives: a status region that appears with its first message is
			     announced by some readers and not by others. -->
			<div role="status">
				<div
					v-if="emptyMessage"
					class="px-4.5 py-8 text-center text-base text-ink-gray-6"
				>
					{{ emptyMessage }}
				</div>
			</div>
			<!-- The same row the palette lists a result as, with the row of the open sheet held on
			     its ground so the reader can see which one they are reading about. -->
			<button
				v-for="row in rows"
				:key="row.id + (row.recurrence_id ?? '')"
				type="button"
				class="flex w-full items-center px-5 py-3 text-left"
				:class="isOpen(row) ? 'bg-surface-gray-2' : 'active:bg-surface-gray-2'"
				@click="emit('select', row)"
			>
				<CalendarSearchResult :result="row" :calendar-options="calendarOptions" :term="query" roomy />
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Button } from 'frappe-ui'

import { sameEvent, type EventIdentity } from '@/apps/calendar/utils/eventIdentity'
import CalendarFilterBadges from '@/apps/calendar/components/CommandPalette/CalendarFilterBadges.vue'
import CalendarFilterPanel from '@/apps/calendar/components/CommandPalette/CalendarFilterPanel.vue'
import CalendarSearchResult from '@/apps/calendar/components/CommandPalette/CalendarSearchResult.vue'
import type {
	CalendarFilterBadge,
	CalendarSearchFilter,
} from '@/apps/calendar/composables/useCalendarSearchFilters'

const props = defineProps<{
	/** The words asked, as the URL carries them — the view owns them, so Back restores them. */
	query: string
	rows: any[]
	searching: boolean
	/** Whether anything has been asked at all, words or a filter, so an empty list can say why. */
	asked: boolean
	filter: CalendarSearchFilter
	badges: CalendarFilterBadge[]
	account: string
	calendarOptions: { label: string; value: string; description?: string; color?: string }[]
	openEvent?: EventIdentity | null
}>()

const emit = defineEmits<{
	'update:query': [string]
	removeFilter: [keyof CalendarSearchFilter]
	clearFilters: []
	select: [any]
}>()

const field = ref<HTMLInputElement | null>(null)
onMounted(() => field.value?.focus())

// The field's text is the URL's; typing writes it up, and the URL writes it back — a Back
// that restores the search restores the field with it.
const text = ref(props.query)
watch(() => props.query, (query) => { if (query !== text.value) text.value = query })
watch(text, (value) => { if (value !== props.query) emit('update:query', value) })

const showFilters = ref(false)
const fieldToFocus = ref('')
const toggleFilters = () => {
	showFilters.value = !showFilters.value
	if (!showFilters.value) fieldToFocus.value = ''
}
const editFilter = (key: string) => {
	fieldToFocus.value = key
	showFilters.value = true
}
// Returning to the field is the way back to the results from the panel — a tap on it closes
// the panel above, and typing does the same here, which also covers the words arriving from
// the URL rather than the keyboard (Back restoring a search while the panel is up).
watch(text, async () => {
	if (!showFilters.value) return
	showFilters.value = false
	await nextTick()
	field.value?.focus()
})

/** Whether a row is the event the sheet is showing — see `sameEvent` for why not by row id. */
const isOpen = (row: any) => sameEvent(props.openEvent, row)

// What the list says when it has no rows, in the palette's own words: what is being searched
// for is quoted back, so "nothing" is plainly about that and not about the calendar.
const emptyMessage = computed(() => {
	if (props.rows.length) return ''
	if (!props.asked) return __('Search events by name, organizer, or attendees.')
	if (props.searching) return __('Searching…')
	const words = props.query.trim()
	return words ? __('No results for "{0}"', [words]) : __('No results')
})
</script>
