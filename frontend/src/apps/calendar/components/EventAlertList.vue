<script setup lang="ts">
import { watch } from 'vue'
import { Button, FormControl } from 'frappe-ui'

import { requestAlertPermission } from '@/utils/calendarAlert'
import {
	ALERT_ACTION_OPTIONS,
	DIRECTION_OPTIONS,
	RELATIVE_TO_OPTIONS,
	UNIT_OPTIONS,
} from '@/apps/calendar/utils/eventOptions'

const { alerts } = defineProps<{ alerts: any[] }>()

// Adding a reminder is the user saying they want to be told: the one moment
// to ask the browser for system notifications, while the click still counts.
watch(
	() => alerts.length,
	(count, previous) => count > previous && requestAlertPermission(),
)

const emit = defineEmits(['update:alerts'])

const updateAlert = (i: number, field: string, value: any) => {
	const updated = alerts.map((a, idx) => (idx === i ? { ...a, [field]: value } : a))
	emit('update:alerts', updated)
}

const removeAlert = (i: number) => {
	const updated = alerts.filter((_, idx) => idx !== i)
	emit('update:alerts', updated)
}
</script>

<template>
	<div v-for="(alert, i) in alerts" :key="i" class="flex space-x-2">
		<FormControl
			:model-value="alert.action === 'Audio' ? 'Display' : alert.action"
			:label="i === 0 ? (alerts.length > 1 ? __('Alerts') : __('Alert')) : ''"
			type="select"
			:options="ALERT_ACTION_OPTIONS"
			class="!w-36 shrink-0"
			@update:model-value="updateAlert(i, 'action', $event)"
		/>
		<template v-if="alert.type === 'OffsetTrigger'">
			<FormControl
				:model-value="alert.number"
				type="number"
				class="mt-auto w-14 shrink-0"
				@update:model-value="updateAlert(i, 'number', $event)"
			/>
			<FormControl
				:model-value="alert.unit"
				type="select"
				:options="UNIT_OPTIONS"
				class="mt-auto min-w-0 grow !w-auto"
				@update:model-value="updateAlert(i, 'unit', $event)"
			/>
			<FormControl
				:model-value="alert.direction"
				type="select"
				:options="DIRECTION_OPTIONS"
				class="mt-auto min-w-0 grow !w-auto"
				@update:model-value="updateAlert(i, 'direction', $event)"
			/>
			<FormControl
				:model-value="alert.relative_to"
				type="select"
				:options="RELATIVE_TO_OPTIONS"
				class="mt-auto min-w-0 grow !w-auto"
				@update:model-value="updateAlert(i, 'relative_to', $event)"
			/>
		</template>
		<template v-else>
			<span class="text-ink-gray-8 mb-1.5 mt-auto text-base">{{ __('on') }}</span>
			<FormControl
				:model-value="alert.date"
				type="date"
				format="MMM D, YYYY"
				:placeholder="__('Select date')"
				class="mt-auto w-full"
				@update:model-value="updateAlert(i, 'date', $event)"
			/>
			<span class="text-ink-gray-8 mb-1.5 mt-auto text-base">{{ __('at') }}</span>
			<FormControl
				:model-value="alert.time"
				type="time"
				:interval="15"
				format="h:mm A"
				:placeholder="__('Select time')"
				class="mt-auto w-full"
				@update:model-value="updateAlert(i, 'time', $event)"
			/>
		</template>
		<Button icon="lucide-x" class="mt-auto" @click="removeAlert(i)" />
	</div>
</template>
