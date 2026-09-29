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
		addElement: ['jumpToSlide', 'undo', 'jumpToElements'],
		removeElement: ['jumpToSlide', 'undo', 'jumpToElements'],
		editElement: ['jumpToSlide', 'jumpToElements', 'undo'],
		batch: ['jumpToSlide', 'undo', 'jumpToElements'],
		editSlide: ['undo', 'jumpToSlide'],
		reorderSlides: ['undo', 'jumpToSlide'],
	},
}

const jumpToSlideByIndex = (index, focus, force = false) => {
	const onActiveSlide = index === slideIndex.value

	if ((force || !onActiveSlide) && index != null) {
		changeEditorSlide(index, focus)

		recentlyRestored.value = true
		setTimeout(() => {
			recentlyRestored.value = false
		}, 1000)
	}
}

let latestJump = 0

const jumpToElementsByIds = (jumpToIds, focusOnId) => {
	if (!jumpToIds?.length) return

	const jump = ++latestJump
	const targetIds = selectableIds(jumpToIds)

	// the elements are gone, so the selection naming them has to go too
	if (!targetIds.every((id) => findSlideElement(id))) {
		activeElementIds.value = []
		if (!findSlideElement(focusElementId.value)) focusElementId.value = null
		return
	}

	if (JSON.stringify(selectableIds(activeElementIds.value)) === JSON.stringify(targetIds)) {
		// the box is measured off the DOM, so it is fitted once the change is patched in
		nextTick(() => {
			if (jump !== latestJump) return
			cropSelectionToFitContent(targetIds)
		})
		return
	}

	nextTick(() => {
		// a whole run of undos lands in one tick, so by now a later one may have
		// decided the selection, or removed the elements this call named
		if (jump !== latestJump) return
		if (!targetIds.every((id) => findSlideElement(id))) return

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
	// adding or removing a slide swaps what is on screen even when the index stays
	const force = ['addSlide', 'removeSlide'].includes(command.key)

	return jumpToSlideByIndex(slideIdx, focus, force)
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
