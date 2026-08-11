<template>
	<Section label="Typography">
		<PropertyRow label="Font">
			<Combobox
				trigger="button"
				variant="ghost"
				size="sm"
				align="end"
				:options="textFonts"
				:modelValue="displayFont"
				class="-me-1"
				@update:modelValue="(value) => onUpdate('fontFamily', value)"
			/>
		</PropertyRow>
		<NumberControl
			:modelValue="editorStyles.fontSize"
			label="Size"
			suffix="px"
			:min="5"
			:max="800"
			:max-digits="3"
			:step="1"
			@update:modelValue="(value) => onUpdate('fontSize', value)"
		/>
		<PropertyRow label="Color">
			<ColorPicker
				:modelValue="editorStyles.color"
				@update:modelValue="(value) => onUpdate('color', value)"
			/>
		</PropertyRow>
		<NumberControl
			:modelValue="parseFloat(editorStyles.lineHeight) || 1.5"
			label="Line Height"
			:min="1"
			:max="5"
			:max-digits="3"
			:step="0.1"
			@update:modelValue="(value) => onUpdate('lineHeight', value, true)"
		/>
		<NumberControl
			:modelValue="editorStyles.letterSpacing || 0"
			label="Letter Spacing"
			suffix="px"
			:min="-10"
			:max="50"
			:max-digits="3"
			:step="1"
			@update:modelValue="(value) => onUpdate('letterSpacing', value, true)"
		/>
		<ToggleGroup
			label="Decor"
			:modelValue="decorValues"
			:options="decorOptions"
			@update:modelValue="onDecorToggle"
		/>
		<PropertyRow label="Align">
			<TabButtons
				:modelValue="editorStyles.textAlign"
				:options="alignOptions"
				@update:modelValue="(value) => onUpdate('textAlign', value)"
			/>
		</PropertyRow>
		<PropertyRow label="List Style">
			<TabButtons
				:modelValue="listStyle"
				:options="listStyleOptions"
				@update:modelValue="(value) => onUpdate('list', value)"
			/>
		</PropertyRow>
	</Section>
</template>

<script setup>
import { computed } from 'vue'

import { Combobox, TabButtons } from 'frappe-ui'
import { Bold, Italic, Underline, Strikethrough } from 'lucide-vue-next'

import ColorPicker from '@/apps/slides/components/controls/ColorPicker.vue'
import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import ToggleGroup from '@/apps/slides/components/controls/ToggleGroup.vue'
import Section from '@/apps/slides/components/controls/Section.vue'

import { useTextEditor } from '@/apps/slides/composables/useTextEditor'

const { editorStyles, updateProperty, toggleMark } = useTextEditor()

const textFonts = [
	'Anton',
	'Arial',
	'Arial Black',
	'Comic Sans MS',
	'Courier New',
	'Courier Prime',
	'Georgia',
	'Helvetica',
	'Impact',
	'Lucida Console',
	'Lucida Sans Unicode',
	'Palatino Linotype',
	'Tahoma',
	'Times New Roman',
	'Trebuchet MS',
	'Verdana',
	'Inter',
]

const decorOptions = [
	{ value: 'bold', label: 'Bold', icon: Bold },
	{ value: 'italic', label: 'Italic', icon: Italic },
	{ value: 'underline', label: 'Underline', icon: Underline },
	{ value: 'strike', label: 'Strikethrough', icon: Strikethrough },
]

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

const decorValues = computed(() =>
	decorOptions.filter((option) => editorStyles[option.value]).map((option) => option.value),
)

const listStyle = computed(() =>
	editorStyles.orderedList ? 'ordered' : editorStyles.bulletList ? 'bullet' : 'none',
)

const displayFont = computed(() => editorStyles.fontFamily?.replace(/['"]/g, ''))

const onUpdate = (property, value, parse = false) => {
	const nextValue = parse ? parseFloat(value) : value
	updateProperty(property, nextValue)
}

const onDecorToggle = (values) => {
	const changed = decorOptions.find(
		(option) => decorValues.value.includes(option.value) !== values.includes(option.value),
	)
	if (changed) toggleMark(changed.value)
}
</script>
