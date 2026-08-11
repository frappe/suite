<template>
	<div :class="rowClasses">
		<span v-if="label" :class="labelClasses">{{ label }}</span>
		<div class="flex items-center gap-1">
			<button
				v-for="option in options"
				:key="option.value"
				type="button"
				:title="option.label"
				:class="getButtonClasses(option)"
				:disabled="option.disabled"
				@click="emit('select', option.value)"
				@mouseenter="emit('hover', option.value)"
				@mouseleave="emit('hover', null)"
			>
				<component
					:is="option.icon"
					class="size-4"
					:class="{ 'text-ink-gray-4': option.disabled }"
				/>
			</button>
		</div>
	</div>
</template>

<script setup>
import { labelClasses } from '@/apps/slides/utils/constants'

const props = defineProps({
	label: String,
	options: {
		type: Array,
		default: () => [],
	},
	active: {
		type: Array,
		default: () => [],
	},
})

const emit = defineEmits(['select', 'hover'])

const rowClasses = 'flex h-7 w-full items-center justify-between'
const buttonClasses =
	'flex cursor-pointer items-center justify-center rounded p-1 text-ink-gray-6 hover:bg-surface-gray-3'
const activeClasses = 'bg-surface-gray-3 text-ink-gray-7'
const disabledClasses = 'pointer-events-none'

const getButtonClasses = (option) => [
	buttonClasses,
	props.active.includes(option.value) && activeClasses,
	option.disabled && disabledClasses,
]
</script>
