<template>
	<div :class="rowClasses">
		<span v-if="label" :class="labelClasses">{{ label }}</span>
		<div class="inline-flex items-center gap-1 rounded-4 bg-surface-base p-px">
			<Tooltip v-for="option in options" :key="option.value" :text="option.label" :hover-delay="0">
				<button type="button" :class="getButtonClass(option.value)" @click="toggle(option.value)">
					<component :is="option.icon" :class="getIconClass(option.value)" />
				</button>
			</Tooltip>
		</div>
	</div>
</template>

<script setup>
import { Tooltip } from 'frappe-ui'

import { labelClasses } from '@/apps/slides/utils/constants'

const model = defineModel({ default: () => [] })

defineProps({
	label: String,
	options: {
		type: Array,
		default: () => [],
	},
})

const isActive = (value) => model.value.includes(value)

const getButtonClass = (value) => [buttonClasses, isActive(value) ? activeClasses : inactiveClasses]

const getIconClass = (value) => [
	iconClasses,
	isActive(value) ? 'text-ink-gray-7' : 'text-ink-gray-6',
]

const toggle = (value) => {
	if (model.value.includes(value)) {
		model.value = model.value.filter((item) => item !== value)
	} else {
		model.value = [...model.value, value]
	}
}

const rowClasses = 'flex h-7 w-full items-center justify-between'
const buttonClasses =
	'flex size-6.5 items-center justify-center rounded-[7px] p-[5px] transition-colors'
const activeClasses = 'bg-surface-elevation-3 shadow-sm'
const inactiveClasses = 'hover:bg-surface-gray-3/80'
const iconClasses = 'size-4 stroke-[1.5]'
</script>
