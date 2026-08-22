<template>
	<Section label="Grid">
		<NumberControl
			:modelValue="activeElement.gridWidth ?? 1"
			label="Weight"
			suffix="px"
			:min="0"
			:max="3"
			:max-digits="3"
			:step="0.5"
			@update:modelValue="gridWidth.set"
			@change-start="gridWidth.begin"
			@change-end="gridWidth.commit"
		/>
		<PropertyRow label="Color">
			<ColorPicker
				:modelValue="activeElement.gridColor || getDefaultGridColor(activeElement.color)"
				@update:modelValue="gridColor.set"
				@colordown="gridColor.begin"
				@colorup="gridColor.commit"
			/>
		</PropertyRow>
	</Section>
</template>

<script setup>
import ColorPicker from '@/apps/slides/components/controls/ColorPicker.vue'
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import Section from '@/apps/slides/components/controls/Section.vue'

import { activeElement } from '@/apps/slides/stores/element'
import { useElementProperty } from '@/apps/slides/composables/editProperty'
import { getDefaultGridColor } from '@/apps/slides/utils/color'

const gridColor = useElementProperty('gridColor')

const gridWidth = useElementProperty('gridWidth')
</script>
