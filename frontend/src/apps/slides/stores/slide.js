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
import { resetFocus } from '@/apps/slides/stores/element'
import { saveChanges, dirty, markDirty } from '@/apps/slides/stores/saving'
import { commandHistory } from '@/apps/slides/stores/historyMeta'
import { generateUniqueId, cloneObj } from '@/apps/slides/utils/helpers'
import { router } from '@/apps/slides/router'

import { toast } from 'frappe-ui'
import { inSlideShowMode } from './slideshow'
import { addSlideCommand, removeSlideCommand } from './commands'

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

const updateSelectionBounds = (newBounds) => {
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

const getNewSlide = (toDuplicate = false, layoutObject) => {
	let layout = null

	if (toDuplicate) {
		layout = currentSlide.value
		layout.elements = layout.elements.map((e) => ({
			...e,
			refId: e.refId || generateUniqueId(),
		}))
	} else {
		layout = layoutObject || null
		layout.elements =
			typeof layout?.elements === 'string'
				? JSON.parse(layout.elements)
				: layout?.elements || []
	}

	let slide = {}
	if (layout) {
		slide = { ...layout }
		slide.elements = layout.elements.map((e) => ({ ...e }))
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

const changeSlide = async (index, focus = true) => {
	index = Math.max(0, Math.min(index, slidesLength.value - 1))

	await router.replace({
		query: { slide: index + 1 },
	})

	if (focus) {
		focusedSlide.value = index
	} else {
		focusedSlide.value = null
	}
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
	toast.promise(saveChanges(), toastProps)
}

const saveSlide = (e) => {
	e.preventDefault()
	resetAndSave()
}

const deleteSlide = (deleteActive) => {
	let deleteIndex = focusedSlide.value
	if (!deleteIndex && deleteActive) deleteIndex = slideIndex.value
	if (deleteIndex == null) return

	// if there is only one slide, reset the slide state instead of deleting
	const totalLength = slides.value.length

	if (totalLength == 1) {
		slides.value[0].elements = []
		focusedSlide.value = null
		markDirty()
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

const changeEditorSlide = async (index, focus = true) => {
	if (!inReadonlyMode.value) {
		await resetFocus()
	}
	return changeSlide(index, focus)
}

const insertDuplicateSlide = async (index, layoutObj, toDuplicate) => {
	if (toDuplicate || !index) index = slideIndex.value

	const newSlide = getNewSlide(toDuplicate, layoutObj)

	if (!toDuplicate) newSlide.elements = await transformElements(newSlide.elements)

	insertSlide(newSlide, index)
}

const duplicateSlide = (e) => {
	e.preventDefault()

	insertDuplicateSlide(slideIndex.value, null, true)
}

const addEmptySlide = (e, index) => {
	e?.preventDefault()
	const layout = templateList.value.find((template) => template.name === presentationTheme.value)
		?.layouts[0]
	if (layout) handleInsertSlide(index, cloneObj(layout))
}

const replaceSlide = (layoutObj) => {
	const index = slideIndex.value
	const newSlide = getNewSlide(false, layoutObj)

	slides.value.splice(index, 1, newSlide)
	slides.value.forEach((slide, index) => {
		slide.idx = index + 1
	})

	markDirty()
}

const handleInsertSlide = (index, layoutObj) => {
	// TODO: change this to use replace
	let replace = false
	if (replace) {
		replaceSlide(layoutObj)
	} else {
		insertDuplicateSlide(index, layoutObj)
	}
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
