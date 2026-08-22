<template>
	<Section label="Frame">
		<NumberControl
			v-for="field in positionFields"
			:key="field.axis"
			:modelValue="Math.round(selectionBounds[field.property])"
			:label="field.label"
			suffix="px"
			:max-digits="4"
			:step="1"
			@update:modelValue="(value) => previewPosition(field.axis, value)"
			@change-start="positionScrub.begin"
			@change-end="positionScrub.commit"
		/>
		<template v-if="!isMultiSelect">
			<NumberControl
				v-for="field in sizeFields"
				:key="field.property"
				:modelValue="Math.round(selectionBounds[field.property])"
				:label="field.label"
				suffix="px"
				:min="1"
				:max-digits="4"
				:step="1"
				:disabled="isElbow || (field.property == 'height' && !canEditHeight)"
				:derived="field.property == 'width' && widthMode == 'auto'"
				@update:modelValue="(value) => sizeScrub.preview(field.property, value)"
				@change-start="sizeScrub.begin"
				@change-end="sizeScrub.commit"
			/>
			<PropertyRow v-if="canSetWidthMode" label="Width Mode">
				<TabButtons
					:modelValue="widthMode"
					:options="widthModes"
					@update:modelValue="setWidthMode"
				/>
			</PropertyRow>
		</template>
		<NumberControl
			v-if="canRotate"
			:modelValue="rotationValue"
			label="Rotate"
			suffix="°"
			:max-digits="3"
			:step="1"
			:disabled="isElbow"
			@update:modelValue="previewRotate"
			@change-start="beginRotateChange"
			@change-end="commitRotateChange"
		/>
	</Section>
</template>

<script setup>
import { computed } from 'vue'

import { TabButtons } from 'frappe-ui'

import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import Section from '@/apps/slides/components/controls/Section.vue'

import {
	activeElement,
	activeElementIds,
	addFixedWidthToElement,
	setAutoWidth,
	setFixedWidth,
} from '@/apps/slides/stores/element'
import { selectionBounds } from '@/apps/slides/stores/slide'
import { commitInteraction, rotationDelta } from '@/apps/slides/stores/interaction'
import { normalizeRotation } from '@/apps/slides/utils/helpers'
import { isAspectLocked } from '@/apps/slides/utils/resize'
import { useInteractionScrub } from '@/apps/slides/composables/useInteractionScrub'

const isMultiSelect = computed(() => activeElementIds.value?.length > 1)

const positionScrub = useInteractionScrub(['left', 'top'])

const previewPosition = (axis, value) =>
	positionScrub.preview(axis == 'X' ? 'left' : 'top', value)

// an elbow's box and angle come from its route
const isElbow = computed(() => !!activeElement.value?.points)

const canEditHeight = computed(() => {
	if (isMultiSelect.value) return false
	if (activeElement.value?.type != 'shape') return false
	return activeElement.value?.shapeType != 'line'
})

const canSetWidthMode = computed(() => {
	if (isMultiSelect.value) return false
	return activeElement.value?.type == 'text'
})

const widthMode = computed(() => (activeElement.value?.width ? 'fixed' : 'auto'))

const setWidthMode = (mode) => {
	if (mode == widthMode.value) return
	if (mode == 'auto') return setAutoWidth()
	setFixedWidth()
}

const canRotate = computed(() => {
	if (isMultiSelect.value) return false
	return ['shape', 'image'].includes(activeElement.value?.type)
})

const rotationValue = computed(() => {
	const deg = (activeElement.value?.rotation || 0) + rotationDelta.value
	return Math.round(normalizeRotation(deg))
})

const hasLockedAspect = computed(() => {
	if (!isAspectLocked(activeElement.value?.type)) return false
	// legacy media without explicit height keeps its aspect via auto height
	return Boolean(activeElement.value?.height)
})

const ensureFixedWidth = () => {
	if (!activeElement.value.width) addFixedWidthToElement()
}

const deriveLockedHeight = (property, value, startBounds) => {
	if (property != 'width' || !hasLockedAspect.value) return
	return { height: value * (startBounds.height / startBounds.width) }
}

const sizeScrub = useInteractionScrub(['width', 'height'], ensureFixedWidth, {
	getLinkedValues: deriveLockedHeight,
})

let rotateStartAngle = null

const beginRotateChange = () => {
	if (rotateStartAngle != null) return
	rotateStartAngle = activeElement.value?.rotation || 0
}

const previewRotate = (value) => {
	if (rotateStartAngle == null) return
	rotationDelta.value = value - rotateStartAngle
}

const commitRotateChange = () => {
	if (rotateStartAngle == null) return
	rotateStartAngle = null
	commitInteraction()
}

const positionFields = [
	{ axis: 'X', property: 'left', label: 'Left' },
	{ axis: 'Y', property: 'top', label: 'Top' },
]

const sizeFields = [
	{ property: 'width', label: 'Width' },
	{ property: 'height', label: 'Height' },
]

const widthModes = [
	{ value: 'auto', label: 'Auto', tooltip: 'Grows with the text' },
	{ value: 'fixed', label: 'Fixed', tooltip: 'Stays the width you set' },
]
</script>
