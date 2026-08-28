<template>
	<Dialog v-model:open="show" v-bind="dialogOptions">
		<template #default>
			<div class="space-y-4">
				<div class="flex flex-col gap-1">
					<button
						v-for="preset in presets"
						:key="preset.label"
						class="hover:bg-surface-gray-2 flex items-center justify-between rounded-4 px-2.5 py-2 text-left"
						@click="confirm(preset.value)"
					>
						<span class="text-ink-gray-7 text-base">{{ preset.label }}</span>
						<span class="text-ink-gray-5 text-sm">{{ preset.display }}</span>
					</button>
				</div>
				<FormControl
					v-model="customValue"
					type="datetime"
					:label="__('Pick a date and time')"
					:min="minLocal"
				/>
				<ErrorMessage :message="error" />
			</div>
		</template>
	</Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Dialog, ErrorMessage, FormControl } from 'frappe-ui'

import dayjs from '@/apps/mail/utils/dayjs'
import { fromLocalInput, inUserTimeZone, userTimeZone } from '@/apps/mail/utils/datetime'

const show = defineModel<boolean>()

const { title, initialValue } = defineProps<{
	// Dialog title; defaults to "Schedule send" (the reschedule flow overrides it).
	title?: string
	// UTC `...Z` timestamp that seeds the custom input (the current send_at when rescheduling).
	initialValue?: string
}>()

const emit = defineEmits<{ confirm: [sendAt: string] }>()

// Mirrors the server-side FUTURERELEASE fallback window; the server revalidates
// against the account's real maxDelayedSend either way.
const MAX_DELAY_DAYS = 30

// The DateTimePicker (FormControl type="datetime") speaks local wall-clock
// 'YYYY-MM-DD HH:mm:ss' strings; fromLocalInput turns them back into UTC Z.
const LOCAL_FORMAT = 'YYYY-MM-DD HH:mm:ss'

const customValue = ref('')
const error = ref('')

watch(show, () => {
	if (!show.value) return
	customValue.value = initialValue ? inUserTimeZone(initialValue).format(LOCAL_FORMAT) : ''
	error.value = ''
})

const minLocal = computed(() => dayjs().tz(userTimeZone()).format(LOCAL_FORMAT))

const presets = computed(() => {
	const now = dayjs().tz(userTimeZone())
	const tomorrow = now.add(1, 'day')
	const monday = now.add((8 - now.day()) % 7 || 7, 'day')

	return [
		{ label: __('Tomorrow morning'), time: tomorrow.hour(8) },
		{ label: __('Tomorrow afternoon'), time: tomorrow.hour(13) },
		{ label: __('Monday morning'), time: monday.hour(8) },
	].map(({ label, time }) => {
		const at = time.minute(0).second(0)
		return {
			label,
			display: at.format('ddd, MMM D, h:mm A'),
			value: fromLocalInput(at.format('YYYY-MM-DDTHH:mm')),
		}
	})
})

const confirm = (sendAt: string) => {
	error.value = ''

	if (dayjs.utc(sendAt).isBefore(dayjs.utc()))
		return (error.value = __('The delivery time must be in the future.'))
	if (dayjs.utc(sendAt).isAfter(dayjs.utc().add(MAX_DELAY_DAYS, 'day')))
		return (error.value = __('The delivery time cannot be more than {0} days ahead.', [
			MAX_DELAY_DAYS,
		]))

	show.value = false
	emit('confirm', sendAt)
}

const confirmCustom = () => {
	if (!customValue.value) return (error.value = __('Please pick a date and time.'))
	confirm(fromLocalInput(customValue.value))
}

const dialogOptions = computed(() => ({
	title: title || __('Schedule send'),
	actions: [
		{
			label: __('Schedule'),
			variant: 'solid',
			onClick: confirmCustom,
		},
	],
}))
</script>
