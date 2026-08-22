<template>
	<Section label="Cell">
		<PropertyRow label="Fill">
			<ColorPicker :modelValue="editorStyles.cellFill" @update:modelValue="setCellFill" />
		</PropertyRow>
	</Section>
</template>

<script setup>
import ColorPicker from '@/apps/slides/components/controls/ColorPicker.vue'
import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import Section from '@/apps/slides/components/controls/Section.vue'

import { useTextEditor } from '@/apps/slides/composables/useTextEditor'
import { setCellFill } from '@/apps/slides/utils/tableCells'

const { editorStyles } = useTextEditor()
</script>
