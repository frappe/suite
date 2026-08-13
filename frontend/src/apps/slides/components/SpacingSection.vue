<template>
	<Section label="Spacing">
		<NumberControl
			:modelValue="parseFloat(editorStyles.lineHeight) || 1.5"
			label="Line Height"
			:min="1"
			:max="5"
			:max-digits="3"
			:step="0.1"
			@update:modelValue="(value) => updateProperty('lineHeight', parseFloat(value))"
		/>
		<NumberControl
			:modelValue="editorStyles.letterSpacing || 0"
			label="Letter Spacing"
			suffix="px"
			:min="-10"
			:max="50"
			:max-digits="3"
			:step="1"
			@update:modelValue="(value) => updateProperty('letterSpacing', parseFloat(value))"
		/>
	</Section>
</template>

<script setup>
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import Section from '@/apps/slides/components/controls/Section.vue'

import { useTextEditor } from '@/apps/slides/composables/useTextEditor'

const { editorStyles, updateProperty } = useTextEditor()
</script>
