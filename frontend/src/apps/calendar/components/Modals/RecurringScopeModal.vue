<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button, Dialog, Radio, RadioGroup } from 'frappe-ui'

import type { RecurringScope, RecurringScopeOption } from '@/apps/calendar/utils/recurringScope'

/**
 * The question a recurring event asks before it is changed: which of its
 * occurrences did you mean?
 *
 * It used to be asked with a button per answer, which put the far-reaching
 * choice — the whole series — in the primary style and left no room for the
 * third answer. Here the answers are a list, the safe one is pre-selected so
 * Enter does the least far-reaching thing, and the single primary button
 * carries the verb of whatever asked: Update, Delete, Send.
 */
const show = defineModel<boolean>()

const {
	title,
	icon = { name: 'lucide-repeat' },
	options,
	confirmLabel,
	theme = 'gray',
	loading = false,
} = defineProps<{
	title: string
	icon?: { name: string; theme?: 'amber' | 'blue' | 'red' | 'green' }
	/** Safest first: the first one that can be picked is the one pre-selected. */
	options: RecurringScopeOption[]
	confirmLabel: string
	theme?: 'gray' | 'red'
	loading?: boolean
}>()

const emit = defineEmits<{ confirm: [scope: RecurringScope] }>()

const scope = ref<RecurringScope>()

// Picked afresh every time it opens. An answer left standing from the last
// time would quietly decide this one — and the two are rarely the same event.
watch(
	() => show.value,
	(open) => {
		if (open) scope.value = options.find((option) => !option.disabled)?.value
	},
	{ immediate: true },
)

const confirm = () => {
	if (scope.value) emit('confirm', scope.value)
}
</script>

<template>
	<Dialog v-model:open="show" size="sm" :title="title" :icon="icon">
		<template #default>
			<RadioGroup v-model="scope" padded>
				<Radio
					v-for="option in options"
					:key="option.value"
					:value="option.value"
					:label="option.label"
					:disabled="option.disabled"
				/>
			</RadioGroup>
		</template>
		<template #actions>
			<!-- Cancel sits away from the verb: the two are opposite answers, and side by
			     side the destructive one is a slip away from the safe one. -->
			<div class="flex items-center justify-between">
				<Button :label="__('Cancel')" variant="ghost" @click="show = false" />
				<Button
					:label="confirmLabel"
					variant="solid"
					:theme="theme"
					:loading="loading"
					:disabled="!scope"
					@click="confirm"
				/>
			</div>
		</template>
	</Dialog>
</template>
