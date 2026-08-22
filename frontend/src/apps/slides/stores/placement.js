import { nextTick } from 'vue'

import { selectionBounds, slideBounds, currentSlide } from './slide'
import {
	activeElements,
	activeElementIds,
	isSelectionLocked,
	getElementPosition,
	isWithinOverlappingBounds,
	normalizeZIndices,
	cropSelectionToFitContent,
} from './element'
import { editElementCommand, batchCommand } from './commands'
import { commandHistory } from './historyMeta'
import { interactionOffset, commitInteraction, getFollowerCommands } from './interaction'
import { cloneObj } from '../utils/helpers'
import { getBoundTargetIds } from '../utils/connectors'

const isHorizontalDirection = (direction) =>
	['left', 'horizontalCenter', 'right'].includes(direction)

const getAlignmentPositions = () => {
	const slideWidth = slideBounds.width / slideBounds.scale
	const slideHeight = slideBounds.height / slideBounds.scale
	const { width: selectionWidth, height: selectionHeight } = selectionBounds

	return {
		left: 0,
		horizontalCenter: (slideWidth - selectionWidth) / 2,
		right: slideWidth - selectionWidth,
		top: 0,
		verticalCenter: (slideHeight - selectionHeight) / 2,
		bottom: slideHeight - selectionHeight,
	}
}

const alignElementsToEachOther = (direction) => {
	const isHorizontal = isHorizontalDirection(direction)
	const property = isHorizontal ? 'left' : 'top'
	const start = isHorizontal ? selectionBounds.left : selectionBounds.top
	const extent = isHorizontal ? selectionBounds.width : selectionBounds.height

	// bound connectors sit out and follow their targets
	const aligned = activeElements.value.filter(
		(element) => !getBoundTargetIds(element.connector).length,
	)
	const moved = {}
	const commands = aligned.map((element) => {
		const position = getElementPosition(element.id)
		const current = isHorizontal ? position.left : position.top
		const size = isHorizontal ? position.right - position.left : position.bottom - position.top

		let target
		if (['left', 'top'].includes(direction)) target = start
		else if (['right', 'bottom'].includes(direction)) target = start + extent - size
		else target = start + (extent - size) / 2

		const newValue = Math.round(element[property] + (target - current))
		moved[element.id] = { [property]: newValue }
		return editElementCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [element.id],
			property,
			oldValue: element[property],
			newValue,
		})
	})
	commands.push(...getFollowerCommands(moved))

	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: activeElementIds.value,
			commands,
		}),
	)

	nextTick(() => cropSelectionToFitContent(activeElementIds.value))
}

// bounds mix fractional and integer measurements, so exact comparison flickers
const getAlignedDirections = () => {
	const positions = getAlignmentPositions()

	return Object.keys(positions).filter((direction) => {
		const current = isHorizontalDirection(direction) ? selectionBounds.left : selectionBounds.top
		return Math.abs(positions[direction] - current) < 1
	})
}

const alignElement = (direction) => {
	if (isSelectionLocked.value) return
	if (activeElementIds.value.length > 1) return alignElementsToEachOther(direction)
	if (getAlignedDirections().includes(direction)) return

	const property = isHorizontalDirection(direction) ? 'left' : 'top'
	const value = Math.round(getAlignmentPositions()[direction])
	interactionOffset[property] = value - selectionBounds[property]
	commitInteraction()
	selectionBounds[property] = value
}

const moveElement = (elements, elementId, moveToIndex, action) => {
	const movingElement = elements.find((el) => el.id == elementId)
	const currentZIndex = movingElement.zIndex

	elements.forEach((el) => {
		const zIndex = el.zIndex
		if (action.includes('back') && zIndex >= moveToIndex && zIndex < currentZIndex) {
			el.zIndex += 1
		} else if (
			['front', 'forward'].includes(action) &&
			zIndex <= moveToIndex &&
			zIndex > currentZIndex
		) {
			el.zIndex -= 1
		}
	})

	movingElement.zIndex = moveToIndex
}

const getElementLists = (action) => {
	const elements = cloneObj(currentSlide.value.elements)
	const active = cloneObj(activeElements.value)

	const sortedActiveElements = ['back', 'backward'].includes(action)
		? active.sort((a, b) => a.zIndex - b.zIndex)
		: active.sort((a, b) => b.zIndex - a.zIndex)

	return { elements, sortedActiveElements }
}

const isElementWithinBounds = (activeId, elementId) => {
	const activePosition = getElementPosition(activeId)
	const elementPosition = getElementPosition(elementId)

	return isWithinOverlappingBounds(activePosition, elementPosition)
}

const initMoveToIndexAndFactor = (elements, sortedActiveElements, action) => {
	const baseIndex = sortedActiveElements[0].zIndex

	const isOverlappingElement = (el) => {
		const isBackward = action == 'backward' && el.zIndex < baseIndex
		const isForward = action == 'forward' && el.zIndex > baseIndex

		if (isBackward || isForward) {
			return isElementWithinBounds(sortedActiveElements[0].id, el.id)
		}
		return false
	}

	switch (action) {
		case 'back':
			return { moveToIndex: 1, factor: 1 }
		case 'front':
			return { moveToIndex: elements.length, factor: -1 }
		case 'backward':
			const lowerZIndices = elements
				.filter((el) => isOverlappingElement(el))
				.map((el) => el.zIndex)
			return {
				moveToIndex: lowerZIndices.length ? Math.max(...lowerZIndices) : 1,
				factor: 1,
			}
		case 'forward':
			const higherZIndices = elements
				.filter((el) => isOverlappingElement(el))
				.map((el) => el.zIndex)
			return {
				moveToIndex: higherZIndices.length ? Math.min(...higherZIndices) : elements.length,
				factor: -1,
			}
		default:
			return { moveToIndex: baseIndex, factor: 1 }
	}
}

const getElementsWithUpdatedZIndices = (action) => {
	const { elements, sortedActiveElements } = getElementLists(action)

	let { moveToIndex, factor } = initMoveToIndexAndFactor(elements, sortedActiveElements, action)

	sortedActiveElements.forEach((element) => {
		moveElement(elements, element.id, moveToIndex, action)
		moveToIndex += factor
	})

	return normalizeZIndices(elements)
}

const getZIndexCommands = (updatedElements) => {
	const commands = []

	updatedElements.forEach((updatedElement) => {
		const originalElement = currentSlide.value.elements.find((el) => el.id == updatedElement.id)

		if (originalElement.zIndex == updatedElement.zIndex) return

		commands.push(
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [updatedElement.id],
				property: 'zIndex',
				oldValue: originalElement.zIndex,
				newValue: updatedElement.zIndex,
			}),
		)
	})

	return commands
}

const getPlacementUpdateCommands = (action) =>
	getZIndexCommands(getElementsWithUpdatedZIndices(action))

// lifts `elementId` just above the topmost of `aboveIds`, nothing if already higher
const getRaiseAboveCommands = (elementId, aboveIds) => {
	const elements = cloneObj(currentSlide.value.elements)
	const find = (id) => elements.find((el) => el.id == id)
	const ceiling = Math.max(...aboveIds.map((id) => find(id)?.zIndex || 1))
	if ((find(elementId).zIndex || 1) > ceiling) return []

	moveElement(elements, elementId, ceiling, 'forward')
	return getZIndexCommands(normalizeZIndices(elements))
}

const arrangeElements = (action) => {
	if (isSelectionLocked.value) return

	const commands = getPlacementUpdateCommands(action)
	if (!commands.length) return
	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: activeElementIds.value,
			commands,
		}),
	)
}

export {
	alignElement,
	arrangeElements,
	getAlignedDirections,
	getAlignmentPositions,
	getRaiseAboveCommands,
}
