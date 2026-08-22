import { computed, nextTick, reactive, ref } from 'vue'

import { currentSlide } from './slide'
import { activeElements, activeElementIds, cropSelectionToFitContent } from './element'
import { getElementDiv } from './elementRegistry'
import { editElementCommand, batchCommand } from './commands'
import { commandHistory } from './historyMeta'
import { normalizeRotation } from '@/apps/slides/utils/helpers'
import { rescaleColumnWidths } from '@/apps/slides/utils/tableWidths'
import { getRaiseAboveCommands } from './placement'
import {
	containsPoint,
	detachMovedEnds,
	getBoundTargetIds,
	routeConnector,
} from '@/apps/slides/utils/connectors'

const interactionOffset = reactive({ left: 0, top: 0, width: 0, height: 0 })

const rotationDelta = ref(0)

// ports to show while an end is dragged over a target; `auto` lights the outline
const bindPreview = ref(null)

// the connector object an endpoint drag commits, in place of the detach rule
const pendingConnector = ref(null)

// the routed points an elbow end drag commits; a box offset can't carry them
const pendingPoints = ref(null)

const isRotatable = (element) => ['shape', 'image'].includes(element.type)

// rendered box: auto-sized text and tables have no stored size, active targets carry the gesture
const getTargetBox = (elementId) => {
	const element = currentSlide.value?.elements.find((el) => el.id === elementId)
	if (!element) return null

	const div = getElementDiv(element.id)
	const box = {
		left: element.left,
		top: element.top,
		width: element.width || div?.offsetWidth || 0,
		height: element.height || div?.offsetHeight || 0,
		rotation: isRotatable(element) ? element.rotation || 0 : 0,
		shapeType: element.shapeType,
	}
	if (!activeElementIds.value.includes(element.id)) return box

	box.left += interactionOffset.left
	box.top += interactionOffset.top
	box.width += interactionOffset.width
	box.height += interactionOffset.height
	if (isRotatable(element)) box.rotation += rotationDelta.value
	return box
}

// topmost element under `point` that a connector end can bind to
const getBindableAt = (point, excludeIds) => {
	const hits = currentSlide.value.elements.filter(
		(element) => !excludeIds.includes(element.id) && element.shapeType !== 'line',
	)
	const target = hits
		.sort((a, b) => (b.zIndex || 1) - (a.zIndex || 1))
		.find((element) => containsPoint(getTargetBox(element.id), point))
	return target ? { elementId: target.id, box: getTargetBox(target.id) } : null
}

const hasLiveGesture = () =>
	interactionOffset.left ||
	interactionOffset.top ||
	interactionOffset.width ||
	interactionOffset.height ||
	rotationDelta.value

// live geometry per following connector; one selected with all its targets moves rigidly instead
const followerGeometry = computed(() => {
	const geometry = {}
	if (!hasLiveGesture()) return geometry

	const active = activeElementIds.value
	currentSlide.value?.elements.forEach((element) => {
		const { connector } = element
		if (!connector) return

		const boundIds = getBoundTargetIds(connector)
		if (!boundIds.some((id) => active.includes(id))) return
		if (active.includes(element.id) && boundIds.every((id) => active.includes(id))) return

		geometry[element.id] = routeConnector(
			element,
			connector.start && getTargetBox(connector.start.elementId),
			connector.end && getTargetBox(connector.end.elementId),
		)
	})
	return geometry
})

const getGeometryCommands = (element, geometry) =>
	Object.entries(geometry)
		.filter(([property, value]) => value != element[property])
		.map(([property, value]) =>
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [element.id],
				property,
				oldValue: element[property],
				newValue: value,
				bypassLock: true,
			}),
		)

// re-route commands for connectors bound into `movedBoxes` ({ [id]: partial box })
const getFollowerCommands = (movedBoxes) => {
	const commands = []
	currentSlide.value.elements.forEach((element) => {
		const { connector } = element
		if (!connector) return
		if (!getBoundTargetIds(connector).some((id) => movedBoxes[id])) return

		const boxFor = (end) => end && { ...getTargetBox(end.elementId), ...movedBoxes[end.elementId] }
		commands.push(
			...getGeometryCommands(
				element,
				routeConnector(element, boxFor(connector.start), boxFor(connector.end)),
			),
		)
	})
	return commands
}

// a text box turns fixed on the first move of the gesture that resizes it, so the
// width has to be recorded from auto for undo to reach the other side of it
let turnedFixedId = null

const markTurnedFixed = (elementId) => {
	turnedFixedId = elementId
}

// a table's frame can't move without its columns: they carry the width. Both callers
// commit bare, so this belongs here rather than in an extraCommands argument, which
// also gets a multi-selection right - each table rescales by its own ratio.
const getColumnRescale = (element) => {
	if (element.type !== 'table' || !interactionOffset.width || !element.width) return null

	const ratio = (element.width + interactionOffset.width) / element.width
	return rescaleColumnWidths(element.content, ratio)
}

// extraCommands join the same batched history entry as the offset commands
const commitInteraction = (extraCommands = []) => {
	const commands = []
	let rescaled = false
	const followers = followerGeometry.value

	activeElements.value.forEach((element) => {
		if (followers[element.id]) return

		const addCommand = (property, oldValue, newValue) => {
			if (newValue == oldValue) return
			commands.push(
				editElementCommand({
					slideId: currentSlide.value.clientId,
					elementIds: [element.id],
					property,
					oldValue,
					newValue,
				}),
			)
		}

		const rescale = getColumnRescale(element)

		;['left', 'top', 'width', 'height'].forEach((key) => {
			const turnedFixed = key === 'width' && element.id === turnedFixedId
			if (!interactionOffset[key] && !turnedFixed) return

			// rounded columns land the table on a width of its own, and the frame
			// has to be recorded at that width rather than where the cursor stopped
			const resized = element[key] + interactionOffset[key]
			const oldValue = turnedFixed ? null : element[key]
			addCommand(key, oldValue, key === 'width' && rescale ? rescale.width : resized)
		})

		if (rescale) {
			addCommand('content', element.content, rescale.content)
			rescaled = true
		}

		const rotation = element.rotation || 0
		if (rotationDelta.value && isRotatable(element)) {
			addCommand('rotation', rotation, normalizeRotation(rotation + rotationDelta.value))
		}

		if (pendingPoints.value) addCommand('points', element.points, pendingPoints.value)

		if (pendingConnector.value) {
			addCommand('connector', element.connector, pendingConnector.value)
			commands.push(...getRaiseAboveCommands(element.id, getBoundTargetIds(pendingConnector.value)))
		} else if (
			// a connector moved without its targets leaves them behind
			element.connector &&
			!getBoundTargetIds(element.connector).every((id) => activeElementIds.value.includes(id))
		) {
			const box = {
				left: element.left + interactionOffset.left,
				top: element.top + interactionOffset.top,
				width: element.width + interactionOffset.width,
				rotation: normalizeRotation(rotation + rotationDelta.value),
			}
			const detached = detachMovedEnds(element, box)
			if (detached) addCommand('connector', element.connector, detached)
		}
	})

	currentSlide.value.elements.forEach((element) => {
		if (followers[element.id]) commands.push(...getGeometryCommands(element, followers[element.id]))
	})

	commands.push(...extraCommands)

	if (commands.length) {
		commandHistory.execute(
			batchCommand({
				slideId: currentSlide.value.clientId,
				elementIds: activeElementIds.value,
				commands,
				skipJumpOnExecute: true,
			}),
		)
	}

	resetInteractionOffset()
	rotationDelta.value = 0
	bindPreview.value = null
	pendingConnector.value = null
	pendingPoints.value = null

	// the box is drawn at the dragged width, the table lands on its rounded columns
	if (rescaled) nextTick(() => cropSelectionToFitContent(activeElementIds.value))
}

const resetInteractionOffset = () => {
	interactionOffset.left = 0
	interactionOffset.top = 0
	interactionOffset.width = 0
	interactionOffset.height = 0
	turnedFixedId = null
}

export {
	interactionOffset,
	rotationDelta,
	bindPreview,
	pendingConnector,
	pendingPoints,
	getTargetBox,
	getBindableAt,
	followerGeometry,
	getFollowerCommands,
	commitInteraction,
	resetInteractionOffset,
	markTurnedFixed,
}
