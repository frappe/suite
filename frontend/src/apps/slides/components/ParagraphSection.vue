<template>
	<Section label="Paragraph">
		<PropertyRow label="Align">
			<TabButtons
				:modelValue="editorStyles.textAlign"
				:options="alignOptions"
				@update:modelValue="(value) => updateProperty('textAlign', value)"
			/>
		</PropertyRow>
		<PropertyRow label="List Style">
			<TabButtons
				:modelValue="listStyle"
				:options="listStyleOptions"
				@update:modelValue="(value) => updateProperty('list', value)"
			/>
		</PropertyRow>
	</Section>
</template>

<script setup>
import { computed } from 'vue'

import { TabButtons } from 'frappe-ui'

import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import Section from '@/apps/slides/components/controls/Section.vue'

import { useTextEditor } from '@/apps/slides/composables/useTextEditor'

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
</script>
