<template>
	<Section label="Element">
		<PropertyRow label="Lock" class="cursor-pointer" @click="toggleFromRow">
			<Switch :modelValue="isSelectionLocked" @update:modelValue="toggleLock()" />
		</PropertyRow>
	</Section>
</template>

<script setup>
import { provide } from 'vue'

import { Switch } from 'frappe-ui'

import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import Section from '@/apps/slides/components/controls/Section.vue'

import { isSelectionLocked, toggleLock } from '@/apps/slides/stores/element'

// the switch handles its own clicks; the rest of the row forwards to it
const toggleFromRow = (e) => {
	if (!e.target.closest('button')) toggleLock()
}

// shadow the panel's provide: locking must not disable the way back out
provide('sectionInert', false)
</script>
