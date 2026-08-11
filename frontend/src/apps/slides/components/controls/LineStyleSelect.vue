<template>
	<Select
		:modelValue="modelValue"
		variant="ghost"
		:options="options"
		class="-me-1"
		@update:modelValue="(value) => emit('update:modelValue', value)"
	>
		<template #trigger="{ selectedOption }">
			<span v-if="selectedOption?.value === 'none'" :class="noneLabelClasses">None</span>
			<span v-else :class="linePreviewClasses(selectedOption?.value)" />
			<span :class="chevronClasses" />
		</template>
		<template #item-label="{ item }">
			<span v-if="item.value === 'none'" :class="noneLabelClasses">None</span>
			<span v-else :class="linePreviewClasses(item.value)" />
		</template>
	</Select>
</template>

<script setup>
import { Select } from 'frappe-ui'

import { chevronClasses } from '@/apps/slides/utils/constants'

defineProps({
	modelValue: { type: String, default: 'solid' },
	options: { type: Array, required: true },
})

const emit = defineEmits(['update:modelValue'])

const lineStyleClasses = {
	solid: 'border-solid',
	dashed: 'border-dashed',
	dotted: 'border-dotted',
}

const linePreviewClasses = (style) => [
	'block w-10 border-t-[1.5px] border-outline-gray-7',
	lineStyleClasses[style],
]

const noneLabelClasses = 'select-none font-text text-base text-ink-gray-7'
</script>
