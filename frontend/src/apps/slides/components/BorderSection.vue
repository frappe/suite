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
				:modelValue="firstEditableElement.borderColor || defaultBorderColor"
				@update:modelValue="borderColor.set"
				@colordown="borderColor.begin"
				@colorup="borderColor.commit"
			/>
		</PropertyRow>
		<NumberControl
			:modelValue="firstEditableElement.borderWidth ?? 0"
			label="Weight"
			suffix="px"
			:min="0"
			:max="50"
			:max-digits="3"
			:step="0.5"
			@update:modelValue="borderWidth.set"
			@change-start="borderWidth.begin"
			@change-end="borderWidth.commit"
		/>
		<NumberControl
			:modelValue="firstEditableElement.borderRadius ?? 0"
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

import { firstEditableElement } from '@/apps/slides/stores/element'
import { useElementProperty } from '@/apps/slides/composables/editProperty'
import { defaultBorderColor, MAX_BORDER_RADIUS } from '@/apps/slides/utils/constants'

const defaultBorderWidth = 1

const borderStyleOptions = [
	{ label: 'None', value: 'none' },
	{ label: 'Solid', value: 'solid' },
	{ label: 'Dashed', value: 'dashed' },
	{ label: 'Dotted', value: 'dotted' },
]

const hasBorder = computed(() => {
	const { borderWidth, borderRadius } = firstEditableElement.value
	return Boolean(Number(borderWidth) || Number(borderRadius))
})

const displayStyle = computed(() => firstEditableElement.value.borderStyle || 'none')

const borderProperties = ['borderColor', 'borderWidth', 'borderStyle']

const useBorderProperty = (property, setWithBorder) => {
	const elementProperty = useElementProperty(property)

	return {
		...elementProperty,
		set: (value) => elementProperty.setEach((el) => setWithBorder(el, value)),
		begin: () => elementProperty.begin(borderProperties),
	}
}

const hasVisibleStyle = (el) => el.borderStyle && el.borderStyle !== 'none'

const borderColor = useBorderProperty('borderColor', (el, value) => {
	el.borderColor = value
	if (!hasVisibleStyle(el)) el.borderStyle = 'solid'
	if (!Number(el.borderWidth)) el.borderWidth = defaultBorderWidth
})

const borderWidth = useBorderProperty('borderWidth', (el, value) => {
	el.borderWidth = value
	if (Number(value) && !hasVisibleStyle(el)) el.borderStyle = 'solid'
})

const borderStyle = useBorderProperty('borderStyle', (el, style) => {
	el.borderStyle = style
	el.borderWidth = style === 'none' ? 0 : Number(el.borderWidth) || defaultBorderWidth
})

const setBorderStyle = (style) => {
	borderStyle.begin()
	borderStyle.set(style)
	borderStyle.commit()
}

const borderRadius = useElementProperty('borderRadius')
</script>
