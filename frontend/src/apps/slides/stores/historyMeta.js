import { ref, nextTick } from 'vue'
import {
	activeElementIds,
	cropSelectionToFitContent,
	findSlideElement,
	focusElementId,
	selectableIds,
	setActiveElements,
} from '@/apps/slides/stores/element'
import { changeEditorSlide, slideIndex, slides } from '@/apps/slides/stores/slide'

let commandHistory = null

const setCommandHistory = (history) => {
	commandHistory = history
}

const recentlyRestored = ref(false)

const actionOrder = {
	execute: {
		addSlide: ['execute', 'jumpToSlide'],
		removeSlide: ['jumpToSlide', 'execute'],
		addElement: ['jumpToSlide', 'execute', 'jumpToElements'],
		removeElement: ['jumpToSlide', 'execute'],
		editElement: ['jumpToSlide', 'jumpToElements', 'execute'],
		batch: ['execute', 'jumpToSlide', 'jumpToElements'],
		editSlide: ['execute', 'jumpToSlide'],
		reorderSlides: ['execute', 'jumpToSlide'],
	},
	undo: {
		addSlide: ['jumpToSlide', 'undo'],
		removeSlide: ['undo', 'jumpToSlide'],
		addElement: ['jumpToSlide', 'undo'],
		removeElement: ['jumpToSlide', 'undo', 'jumpToElements'],
		editElement: ['jumpToSlide', 'jumpToElements', 'undo'],
		batch: ['jumpToSlide', 'undo', 'jumpToElements'],
		editSlide: ['undo', 'jumpToSlide'],
		reorderSlides: ['undo', 'jumpToSlide'],
	},
}

const jumpToSlideByIndex = async (index, focus) => {
	const onActiveSlide = index === slideIndex.value

	if (!onActiveSlide && index != null) {
		await changeEditorSlide(index, focus)

		recentlyRestored.value = true
		setTimeout(() => {
			recentlyRestored.value = false
		}, 1000)
	}
}

const jumpToElementsByIds = (jumpToIds, focusOnId) => {
	if (!jumpToIds?.length) return

	const targetIds = selectableIds(jumpToIds)

	if (!targetIds.every((id) => findSlideElement(id))) {
		activeElementIds.value = []
		return
	}

	if (JSON.stringify(activeElementIds.value) === JSON.stringify(targetIds)) {
		cropSelectionToFitContent(targetIds)
		return
	}

	nextTick(() => {
		// setActiveElements early-returns when the one surviving id is already
		// selected, which would leave the locked ones in the selection
		if (targetIds.length < jumpToIds.length) {
			activeElementIds.value = targetIds
			focusElementId.value = null
		} else {
			setActiveElements(targetIds)
		}

		if (focusOnId && !findSlideElement(focusOnId)?.locked) focusElementId.value = focusOnId
	})
}

const getSlideIndexForJump = (action, command, operation) => {
	if (action !== 'jumpToSlide') return null

	if (['addSlide', 'removeSlide'].includes(command.key)) {
		if (['execute', 'redo'].includes(operation)) return command.jumpToSlideIndex
		if (operation === 'undo') return command.fromSlideIndex
		return null
	}

	if (command.key == 'reorderSlides') {
		if (['execute', 'redo'].includes(operation)) return command.jumpToSlideIndex
		if (operation === 'undo') return command.fromSlideIndex
		return null
	}

	return slides.value.findIndex((s) => s.clientId === command.jumpToSlideId)
}

const handleJumpToSlide = (action, command, operation) => {
	// passive commands (e.g. blur-save) must not navigate away from
	// wherever the user has moved on to; undo/redo should still jump
	if (operation === 'execute' && command.skipJumpOnExecute) return

	const slideIdx = getSlideIndexForJump(action, command, operation)
	const focus = command.key === 'removeSlide' && operation === 'undo' ? false : true

	return jumpToSlideByIndex(slideIdx, focus)
}

const handleJumpToElements = (action, command, operation) => {
	if (operation === 'execute' && command.skipJumpOnExecute) return

	const jumpToIds = command.jumpToElementIds
	const focusOnId = command.focusElementId

	jumpToElementsByIds(jumpToIds, focusOnId)
}

const actions = {
	jumpToSlide: handleJumpToSlide,
	jumpToElements: handleJumpToElements,
}

export { commandHistory, recentlyRestored, actionOrder, actions, setCommandHistory }
