import { ref, computed, reactive } from 'vue'
import { v4 as uuid4 } from 'uuid'
import {
	slidesLength,
	presentationId,
	templateList,
	inReadonlyMode,
	presentationTheme,
	transformElements,
} from '@/apps/slides/stores/presentation'
import { flushPendingBlur, resetFocus } from '@/apps/slides/stores/element'
import { saveChanges, dirty, saveFailed } from '@/apps/slides/stores/saving'
import { commandHistory } from '@/apps/slides/stores/historyMeta'
import { cloneObj } from '@/apps/slides/utils/helpers'
import { remapElementIds } from '@/apps/slides/utils/connectors'
import { router } from '@/apps/slides/router'

import { toast } from 'frappe-ui'
import { inSlideShowMode } from './slideshow'
import { addSlideCommand, removeSlideCommand, editSlideCommand } from './commands'

const slides = ref([])

const slideIndex = ref()
const focusedSlide = ref(null)

const currentSlide = computed(() => slides.value[slideIndex.value])

const selectionBounds = reactive({
	left: 0,
	top: 0,
	width: 0,
	height: 0,
})

const slideBounds = reactive({})

// an element measures zero in one axis while its text editor is swapped out, and
// a selection box never legitimately collapses, so keep the last known size
const updateSelectionBounds = (newBounds) => {
	if (newBounds.width === 0 || newBounds.height === 0) return
	Object.assign(selectionBounds, newBounds)
}

const guideVisibilityMap = reactive({
	centerX: false,
	centerY: false,
	leftEdge: false,
	rightEdge: false,
	topEdge: false,
	bottomEdge: false,
})

const insertSlide = async (newSlide, index) => {
	commandHistory.execute(
		addSlideCommand({
			slide: newSlide,
			index: index + 1,
			slideIndex: slideIndex.value,
		}),
	)
}

const getNewSlide = (toDuplicate = false, layoutObject, source = currentSlide.value) => {
	let layout = null

	if (toDuplicate) {
		layout = { ...source }
	} else {
		layout = layoutObject || null
		layout.elements =
			typeof layout?.elements === 'string' ? JSON.parse(layout.elements) : layout?.elements || []
	}

	let slide = {}
	if (layout) {
		slide = { ...layout }
		// the same layout is inserted more than once, so its stored ids can't carry over
		slide.elements = remapElementIds(layout.elements.map(cloneObj))
	}

	// override metadata and generate unique IDs for elements
	slide.name = ''
	slide.clientId = uuid4()
	slide.parent = presentationId.value
	slide.fadeUnmatchedElements = 1
	slide.transitionDuration = 0
	slide.transition = 'None'

	return slide
}

const setSlideIndex = (index) => {
	index = parseInt(index) - 1
	if (!inSlideShowMode.value) index = Math.min(index, slidesLength.value - 1)
	slideIndex.value = index
}

const changeSlide = (index, focus = true) => {
	index = Math.max(0, Math.min(index, slidesLength.value - 1))

	slideIndex.value = index

	if (focus) {
		focusedSlide.value = index
	} else {
		focusedSlide.value = null
	}

	// the query only mirrors the slide we already landed on, so nothing waits on it
	router.replace({
		query: { slide: index + 1 },
	})
}

const resetAndSave = async () => {
	await resetFocus()
	if (!dirty.value) {
		toast.info('No changes to save')
		return
	}
	const toastProps = {
		loading: `Saving ...`,
		success: () => `Saved`,
		error: () => 'Could not save presentation. Please try again.',
	}
	toast.promise(
		saveChanges().then(() => {
			if (saveFailed.value) throw new Error('Save failed')
		}),
		toastProps,
	)
}

const saveSlide = (e) => {
	e.preventDefault()
	resetAndSave()
}

const deleteSlide = (deleteActive, index) => {
	let deleteIndex = index ?? focusedSlide.value
	if (deleteIndex == null && deleteActive) deleteIndex = slideIndex.value
	if (deleteIndex == null) return

	// if there is only one slide, reset the slide state instead of deleting
	const totalLength = slides.value.length

	if (totalLength == 1) {
		// clearing the only slide's contents must go through history so it stays undoable
		const slide = slides.value[0]
		commandHistory.execute(
			editSlideCommand({
				slideId: slide.clientId,
				property: 'elements',
				oldValue: cloneObj(slide.elements),
				newValue: [],
			}),
		)
		focusedSlide.value = null
		return
	}

	commandHistory.execute(
		removeSlideCommand({
			slide: slides.value[deleteIndex],
			index: deleteIndex,
			slideIndex: slideIndex.value,
		}),
	)
}

const changeEditorSlide = (index, focus = true) => {
	if (!inReadonlyMode.value) {
		flushPendingBlur()
		resetFocus()
	}
	return changeSlide(index, focus)
}

const insertDuplicateSlide = async (index, layoutObj, toDuplicate) => {
	if (index == null) index = slideIndex.value

	const source = slides.value[index]
	const newSlide = getNewSlide(toDuplicate, layoutObj, source)

	if (!toDuplicate) newSlide.elements = await transformElements(newSlide.elements)

	insertSlide(newSlide, index)
}

const duplicateSlide = (index = slideIndex.value) => {
	insertDuplicateSlide(index, null, true)
}

const addEmptySlide = (e, index) => {
	e?.preventDefault()
	const layout = templateList.value.find((template) => template.name === presentationTheme.value)
		?.layouts[0]
	if (layout) handleInsertSlide(index, cloneObj(layout))
}

const handleInsertSlide = (index, layoutObj) => {
	// TODO: support replacing the current slide (must route through command history)
	insertDuplicateSlide(index, layoutObj)
}

export {
	slideIndex,
	slides,
	currentSlide,
	slideBounds,
	selectionBounds,
	guideVisibilityMap,
	focusedSlide,
	updateSelectionBounds,
	insertSlide,
	getNewSlide,
	setSlideIndex,
	changeSlide,
	saveSlide,
	deleteSlide,
	changeEditorSlide,
	duplicateSlide,
	addEmptySlide,
	handleInsertSlide,
}
