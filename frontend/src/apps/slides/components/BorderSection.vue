<template>
	<Section label="Border" :initialState="hasBorder">
		<PropertyRow label="Style">
			<LineStyleSelect
				:modelValue="displayStyle"
				:options="borderStyleOptions"
				@update:modelValue="setBorderStyle"
			/>
		</PropertyRow>
		<PropertyRow label="Color">
			<ColorPicker
				:modelValue="activeElement.borderColor || defaultBorderColor"
				@update:modelValue="setBorderColor"
				@colordown="beginBorderEdit"
				@colorup="commitBorderEdit"
			/>
		</PropertyRow>
		<NumberControl
			:modelValue="activeElement.borderWidth ?? 0"
			label="Weight"
			suffix="px"
			:min="0"
			:max="50"
			:max-digits="3"
			:step="0.5"
			@update:modelValue="setBorderWidth"
			@change-start="beginBorderEdit"
			@change-end="commitBorderEdit"
		/>
		<NumberControl
			:modelValue="activeElement.borderRadius ?? 0"
			label="Radius"
			suffix="px"
			:min="0"
			:max="MAX_BORDER_RADIUS"
			:max-digits="3"
			:step="0.5"
			@update:modelValue="borderRadius.set"
			@change-start="borderRadius.begin"
			@change-end="borderRadius.commit"
		/>
	</Section>
</template>

<script setup>
import { computed } from 'vue'

import ColorPicker from '@/apps/slides/components/controls/ColorPicker.vue'
import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import Section from '@/apps/slides/components/controls/Section.vue'
import LineStyleSelect from '@/apps/slides/components/controls/LineStyleSelect.vue'

import { activeElement } from '@/apps/slides/stores/element'
import {
	setElementProperties,
	useElementProperty,
} from '@/apps/slides/composables/editProperty'
import { defaultBorderColor, MAX_BORDER_RADIUS } from '@/apps/slides/utils/constants'

const defaultBorderWidth = 1

const borderStyleOptions = [
	{ label: 'None', value: 'none' },
	{ label: 'Solid', value: 'solid' },
	{ label: 'Dashed', value: 'dashed' },
	{ label: 'Dotted', value: 'dotted' },
]

const hasBorder = computed(() =>
	Boolean(Number(activeElement.value.borderWidth) || Number(activeElement.value.borderRadius)),
)

const displayStyle = computed(() => activeElement.value.borderStyle || 'none')

const setBorderStyle = (style) => {
	const width = Number(activeElement.value.borderWidth) || 0
	setElementProperties([
		{ property: 'borderStyle', oldValue: activeElement.value.borderStyle, newValue: style },
		{
			property: 'borderWidth',
			oldValue: activeElement.value.borderWidth,
			newValue: style === 'none' ? 0 : width || defaultBorderWidth,
		},
	])
}

const hasVisibleStyle = () =>
	activeElement.value.borderStyle && activeElement.value.borderStyle !== 'none'

let borderSnapshot = null

const beginBorderEdit = () => {
	const el = activeElement.value
	borderSnapshot = {
		borderColor: el.borderColor,
		borderWidth: el.borderWidth,
		borderStyle: el.borderStyle,
	}
}

const setBorderColor = (value) => {
	const el = activeElement.value
	el.borderColor = value
	if (!hasVisibleStyle()) el.borderStyle = 'solid'
	if (!Number(el.borderWidth)) el.borderWidth = defaultBorderWidth
}

const setBorderWidth = (value) => {
	const el = activeElement.value
	el.borderWidth = value
	if (Number(value) && !hasVisibleStyle()) el.borderStyle = 'solid'
}

const commitBorderEdit = () => {
	if (!borderSnapshot) return
	const el = activeElement.value
	setElementProperties(
		['borderColor', 'borderWidth', 'borderStyle'].map((property) => ({
			property,
			oldValue: borderSnapshot[property],
			newValue: el[property],
		})),
	)
	borderSnapshot = null
}

const borderRadius = useElementProperty('borderRadius')
</script>
