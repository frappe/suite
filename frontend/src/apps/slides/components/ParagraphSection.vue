<template>
	<Section label="Paragraph">
		<PropertyRow label="Align">
			<TabButtons
				:modelValue="editorStyles.textAlign"
				:options="alignOptions"
				@update:modelValue="(value) => updateProperty('textAlign', value)"
			/>
		</PropertyRow>
		<PropertyRow v-if="showListStyle" label="List Style">
			<TabButtons
				:modelValue="listStyle"
				:options="listStyleOptions"
				@update:modelValue="(value) => updateProperty('list', value)"
			/>
		</PropertyRow>
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
import { computed } from 'vue'

import { TabButtons } from 'frappe-ui'

import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import Section from '@/apps/slides/components/controls/Section.vue'

import { useTextEditor } from '@/apps/slides/composables/useTextEditor'
import { activeElement, focusElementId } from '@/apps/slides/stores/element'

const { editorStyles, updateProperty } = useTextEditor()

const alignOptions = [
	{ value: 'left', tooltip: 'Align left', icon: 'lucide-align-left' },
	{ value: 'center', tooltip: 'Align center', icon: 'lucide-align-center' },
	{ value: 'right', tooltip: 'Align right', icon: 'lucide-align-right' },
	{ value: 'justify', tooltip: 'Justify', icon: 'lucide-align-justify' },
]

const listStyleOptions = [
	{ value: 'none', tooltip: 'None', icon: 'lucide-ban' },
	{ value: 'bullet', tooltip: 'Bulleted', icon: 'lucide-list' },
	{ value: 'ordered', tooltip: 'Numbered', icon: 'lucide-list-ordered' },
]

const listStyle = computed(() =>
	editorStyles.orderedList ? 'ordered' : editorStyles.bulletList ? 'bullet' : 'none',
)

// a list wraps the block the caret is in, and a table selected as a whole has no caret
const showListStyle = computed(
	() => activeElement.value?.type !== 'table' || focusElementId.value === activeElement.value.id,
)
</script>
