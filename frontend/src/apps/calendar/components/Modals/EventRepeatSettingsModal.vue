<script setup lang="ts">
import { computed, inject, reactive, watch } from 'vue'
import { Repeat } from 'lucide-vue-next'
import { BottomSheet, Button, Dialog, FormControl, TabButtons } from 'frappe-ui'

import { useScreenSize } from '@/composables/useScreenSize'

import { getRepeatMessage } from '@/apps/calendar/utils/format'

const show = defineModel<boolean>()
const { startDate, rRule } = defineProps<{ startDate: string; rRule: any }>()
const emit = defineEmits(['updateRecurrenceRule'])

const dayjs = inject('$dayjs')

// Derived from startDate
const startDay = computed(() => dayjs(startDate).format('dd').toLowerCase())
const startWeekNumber = computed(() => Math.ceil(dayjs(startDate).date() / 7))

// ─── State ────────────────────────────────────────────────────────────────────

const getDefaultRepeat = () => ({
	interval: 1,
	frequency: 'daily',
	end: ' ',
	until: dayjs().add(1, 'week').format('YYYY-MM-DD'),
	count: 10,
	byDay: startDay.value ? [{ day: startDay.value }] : ([] as { day: string }[]),
	repeatOn: 'day_of_month',
})

const parseRRule = () => {
	const defaults = getDefaultRepeat()
	const frequency = rRule.frequency ?? defaults.frequency
	const interval = rRule.interval ?? 1

	let end = ' '
	let until = dayjs().add(1, 'week').format('YYYY-MM-DD')
	let count = 10

	if (rRule.until) {
		end = 'On Date'
		// `until` is a local date-time; strip the `Z` older events carry so the picked
		// date survives instead of shifting a day in zones east of UTC.
		until = dayjs(rRule.until.replace(/Z$/, '')).format('YYYY-MM-DD')
	} else if (rRule.count) {
		end = 'After Occurrences'
		count = rRule.count
	}

	let byDay: { day: string }[] = []
	let repeatOn = 'day_of_month'

	if (frequency === 'weekly') {
		byDay = (rRule.byDay ?? []).map((d: any) => ({ day: d.day }))
		if (!byDay.length) byDay = [{ day: startDay.value }]
	} else if (frequency === 'monthly') {
		if (rRule.byMonthDay) {
			const val = Array.isArray(rRule.byMonthDay) ? rRule.byMonthDay[0] : rRule.byMonthDay
			repeatOn = val === -1 ? 'last_day_of_month' : 'day_of_month'
		} else if (rRule.byDay?.length) {
			const entry = rRule.byDay[0]
			repeatOn = entry.nthOfPeriod === -1 ? 'last_day_of_week' : 'day_of_week'
		}
	}

	return { frequency, interval, end, until, count, byDay, repeatOn }
}

const getRepeat = () => (rRule && Object.keys(rRule).length ? parseRRule() : getDefaultRepeat())

const repeat = reactive({ ...getRepeat() })

const toggleDay = (day: string) => {
	const idx = repeat.byDay.findIndex((d) => d.day === day)
	if (idx === -1) repeat.byDay.push({ day })
	else repeat.byDay.splice(idx, 1)
}

// ─── Watches ──────────────────────────────────────────────────────────────────

// Re-sync state when dialog opens
watch(show, (val) => {
	if (val) Object.assign(repeat, getRepeat())
})

// Set default byDay when switching to weekly
watch(
	() => repeat.frequency,
	(freq) => {
		if (freq === 'weekly' && !repeat.byDay.length) repeat.byDay = [{ day: startDay.value }]
	},
)

// ─── Computed ─────────────────────────────────────────────────────────────────

const monthlyRepeatOnOptions = computed(() => {
	const date = dayjs(startDate)
	const dayName = date.format('dddd')
	const ordinals = [__('First'), __('Second'), __('Third'), __('Fourth'), __('Fifth')]
	const daysInMonth = date.daysInMonth()

	const options = [{ label: __('{0} of Month', [date.format('Do')]), value: 'day_of_month' }]

	if (date.date() === daysInMonth)
		options.push({ label: __('Last Day of Month'), value: 'last_day_of_month' })

	options.push({
		label: __('{0} {1} of Month', [ordinals[startWeekNumber.value - 1], dayName]),
		value: 'day_of_week',
	})

	if (startWeekNumber.value === Math.ceil(daysInMonth / 7) || daysInMonth - date.date() < 7)
		options.push({ label: __('Last {0} of Month', [dayName]), value: 'last_day_of_week' })

	return options
})

const recurrenceRule = computed(() => {
	const rule: Record<
		string,
		string | string[] | number | number[] | { day: string; nthOfPeriod?: number }[]
	> = { frequency: repeat.frequency, interval: repeat.interval }

	if (repeat.frequency === 'weekly' && repeat.byDay.length) {
		rule.byDay = repeat.byDay
	} else if (repeat.frequency === 'monthly') {
		const monthlyByDay = {
			day_of_week: [{ day: startDay.value, nthOfPeriod: startWeekNumber.value }],
			last_day_of_week: [{ day: startDay.value, nthOfPeriod: -1 }],
		}
		const monthlyByMonthDay = {
			day_of_month: [dayjs(startDate).date()],
			last_day_of_month: [-1],
		}

		if (repeat.repeatOn in monthlyByDay) rule.byDay = monthlyByDay[repeat.repeatOn]
		else rule.byMonthDay = monthlyByMonthDay[repeat.repeatOn]
	}

	// JSCalendar `until` is a LocalDateTime in the event's zone (RFC 8984) — no `Z`.
	if (repeat.end === 'On Date') rule.until = `${repeat.until}T23:59:59`
	else if (repeat.end === 'After Occurrences') rule.count = repeat.count

	return rule
})

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEKDAYS = [
	{ label: __('Su'), value: 'su' },
	{ label: __('Mo'), value: 'mo' },
	{ label: __('Tu'), value: 'tu' },
	{ label: __('We'), value: 'we' },
	{ label: __('Th'), value: 'th' },
	{ label: __('Fr'), value: 'fr' },
	{ label: __('Sa'), value: 'sa' },
]

const FREQUENCIES = [
	{ label: __('Day'), value: 'daily' },
	{ label: __('Week'), value: 'weekly' },
	{ label: __('Month'), value: 'monthly' },
	{ label: __('Year'), value: 'yearly' },
]

const END_OPTIONS = [
	{ label: __('Never'), value: ' ' },
	{ label: __('On Date'), value: 'On Date' },
	{ label: __('After Occurrences'), value: 'After Occurrences' },
]

const { isMobile } = useScreenSize()

const DIALOG_OPTIONS = { title: __('Repeat') }

const apply = () => {
	emit('updateRecurrenceRule', recurrenceRule.value)
	show.value = false
}

const removeRepeat = () => {
	emit('updateRecurrenceRule', {})
	show.value = false
}
</script>

<template>
	<!-- One set of fields, two shells. A centred dialog is right at a desk and wrong
	     over a form that fills the phone: everything else this form opens — the alert,
	     availability, visibility — comes up from the bottom, and repeat arriving in the
	     middle of the screen read as a different layer of the app. The fields are
	     written once and handed to whichever shell the device asks for. -->
	<component
		:is="isMobile ? BottomSheet : Dialog"
		v-bind="DIALOG_OPTIONS"
		:open="show"
		@update:open="(value: boolean) => (show = value)"
	>
		<template #default>
			<div
				class="space-y-4"
				:class="isMobile && 'px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]'"
			>
				<!-- Interval + segmented frequency -->
				<div>
					<label class="mb-1.5 block text-xs text-ink-gray-5">{{ __('Repeat Every') }}</label>
					<div class="flex gap-2.5">
						<FormControl v-model.number="repeat.interval" type="number" class="w-14 shrink-0" />
						<TabButtons
							v-model="repeat.frequency"
							:options="FREQUENCIES"
							class="min-w-0 flex-1 [&>div]:w-full [&>div>[data-slot=tab-button]]:flex-1 [&_[data-slot=tab-button]>span]:w-full"
						/>
					</div>
				</div>

				<!-- Weekly: weekday dots -->
				<div v-if="repeat.frequency === 'weekly'">
					<label class="mb-1.5 block text-xs text-ink-gray-5">{{ __('On') }}</label>
					<div class="flex gap-1.5">
						<button
							v-for="d in WEEKDAYS"
							:key="d.value"
							type="button"
							class="size-7 rounded-full text-xs focus:outline-none"
							:class="
								repeat.byDay.some((x) => x.day === d.value)
									? 'bg-surface-gray-10 text-ink-base'
									: 'bg-surface-gray-2 text-ink-gray-8'
							"
							@click="toggleDay(d.value)"
						>
							{{ d.label }}
						</button>
					</div>
				</div>

				<!-- Monthly: repeat-on select -->
				<div v-else-if="repeat.frequency === 'monthly'">
					<label class="mb-1.5 block text-xs text-ink-gray-5">{{ __('On') }}</label>
					<FormControl v-model="repeat.repeatOn" type="select" :options="monthlyRepeatOnOptions" />
				</div>

				<!-- End condition -->
				<div>
					<label class="mb-1.5 block text-xs text-ink-gray-5">{{ __('Ends') }}</label>
					<div class="grid grid-cols-2 items-center gap-2.5">
						<FormControl v-model="repeat.end" type="select" :options="END_OPTIONS" />
						<!-- The platform's own picker on a phone, as the rest of this form
						     uses for the event's dates and its alerts. `FormControl type="date"`
						     is frappe-ui's DatePicker — a popover calendar, which inside a
						     bottom sheet is a layer on a layer, where the native control opens
						     as a sheet of the system's own. -->
						<input
							v-if="isMobile && repeat.end === 'On Date'"
							v-model="repeat.until"
							type="date"
							class="w-full rounded-4 border-outline-gray-2 bg-surface-base px-2 py-1 text-p-base text-ink-gray-8 focus:border-outline-gray-3 focus:ring-0"
						/>
						<FormControl
							v-else-if="repeat.end === 'On Date'"
							v-model="repeat.until"
							type="date"
							class="w-full"
						/>
						<FormControl
							v-else-if="repeat.end === 'After Occurrences'"
							v-model.number="repeat.count"
							type="number"
							class="w-full"
						/>
					</div>
				</div>

				<!-- Summary -->
				<!-- Plain text over a rule, not a filled box: every filled box above it is
				     something to fill in, and a sentence wearing the same fill read as one
				     more field — one that ignored being typed in. The rule is what separates
				     the reading of the rule from the setting of it.

				     The summary is a sentence, not a chip: pick enough days and it wraps,
				     and a centred icon then floats against the middle of a two-line
				     block with nothing on its own line. It sits on the first line
				     instead — mt-1 is the half-leading that puts a 14px glyph on the
				     optical centre of a 21px line — and the text takes the rest of the
				     width so the block reads as a paragraph rather than as a label that
				     outgrew its badge.

				     text-p-sm, not text-sm: the size's own line-height is meant for a label
				     that never wraps, and this wraps as soon as enough days are picked —
				     two lines of it would sit with the descenders of one nearly touching
				     the caps of the next. The paragraph variant of the same size leaves
				     the leading a sentence needs. -->
				<div
					class="flex items-start gap-2.5 border-t border-outline-gray-1 pt-3 text-p-sm text-ink-gray-8"
				>
					<Repeat :size="14" class="mt-1 shrink-0 text-ink-gray-5" />
					<span class="min-w-0 flex-1">{{ getRepeatMessage(recurrenceRule) }}</span>
				</div>
				<!-- On a phone the actions travel with the fields: a sheet has no actions
				     slot of its own, and a full-width pair is what a thumb reaches anyway. -->
				<div v-if="isMobile" class="flex gap-2 pt-1">
					<Button class="flex-1" :label="__('Remove Repeat')" @click="removeRepeat" />
					<Button class="flex-1" :label="__('Apply')" variant="solid" @click="apply" />
				</div>
			</div>
		</template>
		<template v-if="!isMobile" #actions>
			<div class="flex justify-end gap-2">
				<Button :label="__('Remove Repeat')" @click="removeRepeat" />
				<Button :label="__('Apply')" variant="solid" @click="apply" />
			</div>
		</template>
	</component>
</template>
