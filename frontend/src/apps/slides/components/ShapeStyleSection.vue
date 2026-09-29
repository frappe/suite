<template>
	<Section label="Style">
		<PropertyRow label="Stroke Style">
			<LineStyleSelect
				:modelValue="displayStrokeStyle"
				:options="strokeStyleOptions"
				@update:modelValue="setStrokeStyle"
			/>
		</PropertyRow>
		<NumberControl
			:modelValue="firstEditableElement.strokeWidth ?? 0"
			label="Stroke Width"
			suffix="px"
			:min="strokeMin"
			:max="50"
			:max-digits="3"
			:step="0.5"
			@update:modelValue="strokeWidth.set"
			@change-start="strokeWidth.begin"
			@change-end="strokeWidth.commit"
		/>
		<PropertyRow label="Stroke Color">
			<ColorPicker
				:modelValue="firstEditableElement.strokeColor"
				@update:modelValue="strokeColor.set"
				@colordown="strokeColor.begin"
				@colorup="strokeColor.commit"
			/>
		</PropertyRow>
		<PropertyRow v-if="!hasLine" label="Fill Color">
			<ColorPicker
				:modelValue="firstEditableElement.fillColor"
				@update:modelValue="fillColor.set"
				@colordown="fillColor.begin"
				@colorup="fillColor.commit"
			/>
		</PropertyRow>
		<NumberControl
			v-if="isRectangleSelection"
			:modelValue="firstEditableElement.borderRadius ?? 0"
			label="Corner Radius"
			suffix="px"
			:min="0"
			:max="MAX_BORDER_RADIUS"
			:max-digits="3"
			:step="0.5"
			@update:modelValue="borderRadius.set"
			@change-start="borderRadius.begin"
			@change-end="borderRadius.commit"
		/>
		<template v-if="isLineSelection">
			<PropertyRow v-if="activeElement?.connector" label="Line Type">
				<TabButtons
					:modelValue="activeElement.connector.route"
					:options="lineTypes"
					@update:modelValue="setLineType"
				/>
			</PropertyRow>
			<PropertyRow label="Line Start">
				<ArrowheadSelect
					:modelValue="normalizeMarker(firstEditableElement.markerStart) ?? 'none'"
					mirrored
					@update:modelValue="(value) => setMarker('markerStart', value)"
				/>
			</PropertyRow>
			<PropertyRow label="Line End">
				<ArrowheadSelect
					:modelValue="normalizeMarker(firstEditableElement.markerEnd) ?? 'none'"
					@update:modelValue="(value) => setMarker('markerEnd', value)"
				/>
			</PropertyRow>
		</template>
	</Section>
</template>

<script setup>
import { computed } from 'vue'
import { TabButtons } from 'frappe-ui'

import ColorPicker from '@/apps/slides/components/controls/ColorPicker.vue'
import PropertyRow from '@/apps/slides/components/controls/PropertyRow.vue'
import NumberControl from '@/apps/slides/components/controls/NumberControl.vue'
import Section from '@/apps/slides/components/controls/Section.vue'
import LineStyleSelect from '@/apps/slides/components/controls/LineStyleSelect.vue'
import ArrowheadSelect from '@/apps/slides/components/controls/ArrowheadSelect.vue'
import LineStraight from '@/apps/slides/icons/LineStraight.vue'
import LineElbow from '@/apps/slides/icons/LineElbow.vue'
import { MAX_BORDER_RADIUS } from '@/apps/slides/utils/constants'
import { normalizeMarker } from '@/apps/slides/utils/lineMarkers'
import { routeConnector } from '@/apps/slides/utils/connectors'
import { setStrokeWidthInPlace } from '@/apps/slides/utils/shapeGeometry'

import {
	activeElement,
	activeElements,
	firstEditableElement,
	rememberMarkers,
} from '@/apps/slides/stores/element'
import { getTargetBox } from '@/apps/slides/stores/interaction'
import {
	setElementProperties,
	setElementProperty,
	useElementProperty,
} from '@/apps/slides/composables/editProperty'

const strokeStyleOptions = [
	{ label: 'Solid', value: 'solid' },
	{ label: 'Dashed', value: 'dashed' },
	{ label: 'Dotted', value: 'dotted' },
]

const displayStrokeStyle = computed(() => firstEditableElement.value.strokeStyle || 'solid')

const setStrokeStyle = (value) => setElementProperty('strokeStyle', value)

const lineTypes = [
	{ value: 'straight', tooltip: 'Straight', icon: LineStraight },
	{ value: 'elbow', tooltip: 'Elbow', icon: LineElbow },
]

// bound ends re-route for the new type, free ends stay put
const setLineType = (route) => {
	const line = activeElement.value
	const connector = { ...line.connector, route }
	const boxFor = (end) => end && getTargetBox(end.elementId)
	const geometry = routeConnector(
		{ ...line, connector },
		boxFor(connector.start),
		boxFor(connector.end),
	)
	setElementProperties([
		{ property: 'connector', oldValue: line.connector, newValue: connector },
		...['left', 'top', 'width', 'height', 'rotation', 'points'].map((property) => ({
			property,
			oldValue: line[property],
			newValue: geometry[property],
		})),
	])
}

const setMarker = (property, value) => {
	setElementProperty(property, value)
	rememberMarkers(firstEditableElement.value)
}

const hasLine = computed(() => activeElements.value.some((el) => el.shapeType === 'line'))
const isLineSelection = computed(() =>
	activeElements.value.every((el) => el.shapeType === 'line'),
)
const isRectangleSelection = computed(() =>
	activeElements.value.every((el) => el.shapeType === 'rectangle'),
)

const strokeMin = computed(() => (hasLine.value ? 0.5 : 0))

const borderRadius = useElementProperty('borderRadius')

const strokeWidthProperty = useElementProperty('strokeWidth')
const strokeWidth = {
	...strokeWidthProperty,
	begin: () => strokeWidthProperty.begin(['strokeWidth', 'top', 'height']),
	set: (value) => strokeWidthProperty.setEach((el) => setStrokeWidthInPlace(el, value)),
}

const fillColor = useElementProperty('fillColor')
const strokeColor = useElementProperty('strokeColor')
</script>
