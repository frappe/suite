import { ref, computed, nextTick, watch } from 'vue'
import { call, createResource } from 'frappe-ui'

import {
	selectionBounds,
	slides,
	slideBounds,
	updateSelectionBounds,
	currentSlide,
	slideIndex,
} from './slide'
import { useTextEditor } from '@/apps/slides/composables/useTextEditor'

import { getElementDiv } from './elementRegistry'
import { markDirty } from './saving'
import { generateUniqueId, cloneObj } from '../utils/helpers'
import { guessTextColorFromBackground, guessShapeColorsFromBackground } from '../utils/color'
import { presentationId } from './presentation'
import { getCommandsToInitElementRefId, getCommandsToUpdateElementRefId } from './transition'
import { commandHistory } from './historyMeta'

import { generateHTML } from '@tiptap/core'
import { extensions, patchEmptyParagraphs } from '@/apps/slides/stores/tiptapSetup'
import {
	editElementCommand,
	batchCommand,
	addElementCommand,
	removeElementCommand,
} from '@/apps/slides/stores/commands'

const activeElementIds = ref([])
const focusElementId = ref(null)
const pairElementId = ref(null)
const pendingShapeType = ref(null)

const activeElements = computed(() => {
	let elements = []
	currentSlide.value?.elements.forEach((element) => {
		if (activeElementIds.value.includes(element.id)) {
			elements.push(element)
		}
	})
	return elements
})

const activeElement = computed(() => {
	if (focusElementId.value) {
		return currentSlide.value?.elements.find((element) => element.id === focusElementId.value)
	} else if (activeElementIds.value.length == 1) {
		return activeElements.value[0]
	}
})

const setActiveElements = (ids, focus = false) => {
	if (ids.length == 1 && activeElementIds.value.includes(ids[0])) return
	activeElementIds.value = ids
	focusElementId.value = null
}

const getElementContent = (element) => {
	const contentJSON = {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				attrs: {
					textAlign: element.textAlign || 'center',
					lineHeight: element.lineHeight || 1.5,
				},
				content: [
					{
						type: 'text',
						text: element.innerText || 'Text',
						marks: [
							{
								type: 'textStyle',
								attrs: {
									fontSize: element.fontSize,
									fontFamily: element.fontFamily,
									color: element.color,
									letterSpacing: element.letterSpacing,
									opacity: 100,
								},
							},
						],
					},
				],
			},
		],
	}

	return generateHTML(contentJSON, extensions)
}

const getInitialShapeTextContent = (shapeElement) => {
	return getElementContent({
		textAlign: 'center',
		lineHeight: 1.5,
		fontSize: 20,
		fontFamily: 'Inter',
		color: guessTextColorFromBackground(shapeElement.fillColor || '#ffffff'),
		letterSpacing: 0,
		innerText: '​',
	})
}

const getShapeDefaults = (shapeType) => {
	let width, height, strokeColor, strokeWidth, borderRadius, elementShapeType
	let markerStart = false
	let markerEnd = false

	const { fillColor, strokeColor: defaultStrokeColor } = guessShapeColorsFromBackground(currentSlide.value?.background)

	switch (shapeType) {
		case 'rectangle':
			width = 300
			height = 200
			strokeColor = defaultStrokeColor
			strokeWidth = 2
			borderRadius = 0
			elementShapeType = 'rectangle'
			break
		case 'oval':
		case 'circle':
			width = 300
			height = 200
			strokeColor = defaultStrokeColor
			strokeWidth = 2
			borderRadius = 0
			elementShapeType = 'oval'
			break
		case 'diamond':
		case 'triangle':
		case 'pentagon':
			width = 300
			height = 300
			strokeColor = defaultStrokeColor
			strokeWidth = 2
			borderRadius = 0
			elementShapeType = shapeType
			break
		case 'line':
			width = 300
			height = 1
			strokeColor = defaultStrokeColor
			strokeWidth = 1
			borderRadius = 0
			elementShapeType = 'line'
			break
	}

	return {
		width,
		height,
		strokeColor,
		strokeWidth,
		borderRadius,
		fillColor,
		elementShapeType,
		markerStart,
		markerEnd,
	}
}

const lineBoundsFromEndpoints = ({ x1, y1, x2, y2 }, height) => {
	const dx = x2 - x1
	const dy = y2 - y1
	const length = Math.sqrt(dx ** 2 + dy ** 2)
	return {
		width: length,
		height,
		left: (x1 + x2) / 2 - length / 2,
		top: (y1 + y2) / 2 - height / 2,
		rotation: Math.atan2(dy, dx) * (180 / Math.PI),
	}
}

const addShapeElement = async (shapeType, bounds = null) => {
	if (!shapeType) return

	const {
		width: defaultWidth,
		height: defaultHeight,
		fillColor,
		strokeColor,
		strokeWidth,
		borderRadius,
		elementShapeType,
		markerStart,
		markerEnd,
	} = getShapeDefaults(shapeType)

	if (!elementShapeType) return

	const slideWidth = slideBounds.width / slideBounds.scale
	const slideHeight = slideBounds.height / slideBounds.scale

	if (elementShapeType === 'line' && bounds?.x1 !== undefined) {
		bounds = lineBoundsFromEndpoints(bounds, defaultHeight)
	}

	const width = bounds?.width ?? defaultWidth
	const height = elementShapeType === 'line' ? defaultHeight : (bounds?.height ?? defaultHeight)
	const left = bounds?.left ?? (slideWidth - width) / 2
	const top = bounds?.top ?? (slideHeight - height) / 2

	const element = {
		id: generateUniqueId(),
		zIndex: currentSlide.value.elements.length + 1,
		width,
		height,
		left,
		top,
		opacity: 100,
		rotation: bounds?.rotation ?? 0,
		type: 'shape',
		shapeType: elementShapeType,
		fillColor,
		strokeColor,
		strokeWidth,
		borderRadius,
		markerStart,
		markerEnd,
		shadowOffsetX: 0,
		shadowOffsetY: 0,
		shadowSpread: 0,
		shadowColor: '#7C7C7CFF',
	}

	const refCommands = getCommandsToUpdateElementRefId(element) || []

	const commands = [
		addElementCommand({
			slideId: currentSlide.value.clientId,
			element: element,
		}),
		...refCommands,
	]

	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [element.id],
			commands,
		}),
	)
}

const getTextElementDimensions = (presets) => {
	const tempTextElement = document.createElement('div')

	Object.assign(tempTextElement.style, {
		position: 'absolute',
		visibility: 'hidden',
		height: 'auto',
		width: 'auto',
		whiteSpace: 'pre',
		fontSize: `${presets.fontSize}px`,
		fontFamily: presets.fontFamily,
		letterSpacing: `${presets.letterSpacing}px`,
		color: presets.color || '#000000',
	})
	tempTextElement.innerHTML = presets.innerText || 'Text'

	document.body.appendChild(tempTextElement)

	const elementWidth = tempTextElement.offsetWidth
	const elementHeight = tempTextElement.offsetHeight

	document.body.removeChild(tempTextElement)

	return { elementWidth, elementHeight }
}

const addTextElement = async (text, position) => {
	const elementPresets = {
		textAlign: 'left',
		fontSize: 28,
		fontFamily: 'Inter',
		color: guessTextColorFromBackground(currentSlide.value.background),
		innerText: text,
		letterSpacing: 0,
		lineHeight: 1.5,
	}

	if (!position) {
		const { elementWidth, elementHeight } = getTextElementDimensions(elementPresets)
		position = getLeftTopForCenteredElement(elementWidth, elementHeight)
	}

	const element = {
		id: generateUniqueId(),
		zIndex: currentSlide.value.elements.length + 1,
		transformOrigin: 'top left',
		transform: 'none',
		left: position.left,
		top: position.top,
		type: 'text',
		content: getElementContent(elementPresets),
		lineHeight: elementPresets.lineHeight,
	}

	const refCommands = getCommandsToUpdateElementRefId(element) || []

	const commands = [
		addElementCommand({
			slideId: currentSlide.value.clientId,
			element: element,
		}),
		...refCommands,
	]

	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [element.id],
			focusElementId: element.id,
			commands,
		}),
	)
}

const savePoster = createResource({
	url: 'suite.slides.doctype.presentation.presentation.save_base64_image',
	makeParams: (posterDataUrl) => ({
		presentation_name: presentationId.value,
		base64_data: posterDataUrl,
		prefix: 'poster',
	}),
})

const saveMediaFrameAsPoster = async (media, width, height) => {
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height

	const context = canvas.getContext('2d')
	context.drawImage(media, 0, 0, canvas.width, canvas.height)

	return await savePoster.submit(canvas.toDataURL('image/webp'))
}

const generatePoster = async (video) => {
	return await saveMediaFrameAsPoster(video, video.videoWidth, video.videoHeight)
}

const isGifFile = (file) => {
	return (
		file.file_type?.toLowerCase() === 'gif' ||
		file.file_name?.toLowerCase().endsWith('.gif') ||
		file.file_url?.toLowerCase().endsWith('.gif')
	)
}

const generateImagePoster = async (imageUrl) => {
	const img = new Image()
	img.src = imageUrl
	await img.decode()

	return await saveMediaFrameAsPoster(img, img.naturalWidth, img.naturalHeight)
}

const getVideoElementClone = (videoUrl) => {
	const videoElement = document.createElement('video')

	videoElement.crossOrigin = 'anonymous'
	videoElement.preload = 'auto'
	videoElement.muted = true
	videoElement.src = videoUrl
	videoElement.style.position = 'absolute'
	videoElement.style.left = '-9999px'
	videoElement.style.width = '400px'
	videoElement.style.height = 'auto'

	return videoElement
}

const handleVideoCloneDataLoad = async (videoClone, resolve, reject) => {
	try {
		const poster = await generatePoster(videoClone)
		const aspectRatio = videoClone.videoWidth / videoClone.videoHeight
		resolve({ posterURL: poster, aspectRatio: aspectRatio })
	} catch (err) {
		reject(err)
	} finally {
		// remove the video element from the DOM after poster is generated
		document.body.removeChild(videoClone)
	}
}

const getVideoPoster = async (videoUrl) => {
	return new Promise((resolve, reject) => {
		// create a clone of the video element to generate a poster
		// without making the original video visible so there's no flicker
		const videoClone = getVideoElementClone(videoUrl)
		document.body.appendChild(videoClone)

		// we cannot directly capture the poster without data load event
		videoClone.addEventListener(
			'loadeddata',
			() => handleVideoCloneDataLoad(videoClone, resolve, reject),
			{ once: true },
		)

		videoClone.addEventListener(
			'error',
			() => {
				// if video fails to load, don't leave cloned element in the DOM
				document.body.removeChild(videoClone)
				reject(new Error('Failed to load video for poster generation'))
			},
			{ once: true },
		)
	})
}

const getNaturalSize = async (dataURL) => {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () =>
			resolve({
				width: (img.naturalWidth / 2) * slideBounds.scale,
				aspectRatio: img.naturalWidth / img.naturalHeight,
			})
		img.onerror = reject
		img.src = dataURL
	})
}

const getLeftTopForCenteredElement = (elementWidth, elementHeight) => {
	const slideWidth = slideBounds.width / slideBounds.scale
	const slideHeight = slideBounds.height / slideBounds.scale

	const elementLeft = (slideWidth - elementWidth) / 2
	const elementTop = (slideHeight - elementHeight) / 2

	return { left: elementLeft, top: elementTop }
}

const addMediaElement = async (file, type) => {
	const src = file.file_url

	let elementWidth = 0

	let position = {
		left: 0,
		top: 0,
	}

	let videoPoster = null
	let imagePoster = null

	if (type == 'image') {
		const { width, aspectRatio } = await getNaturalSize(src)
		elementWidth = Math.max(Math.min(width, 800), 30)
		const elementHeight = elementWidth / aspectRatio
		position = getLeftTopForCenteredElement(elementWidth, elementHeight)
		if (isGifFile(file)) {
			imagePoster = await generateImagePoster(src)
		}
	} else {
		elementWidth = 400
		const { posterURL, aspectRatio } = await getVideoPoster(src)
		const elementHeight = elementWidth / aspectRatio
		position = getLeftTopForCenteredElement(elementWidth, elementHeight)
		videoPoster = posterURL
	}

	let element = {
		id: generateUniqueId(),
		zIndex: currentSlide.value.elements.length + 1,
		width: elementWidth,
		left: position.left,
		top: position.top,
		opacity: 100,
		type: type,
		src: src,
		attachmentName: file.name,
		borderStyle: 'none',
		borderWidth: 0,
		borderRadius: 0,
		borderColor: '',
		shadowOffsetX: 0,
		shadowOffsetY: 0,
		shadowSpread: 0,
		shadowColor: '#7C7C7CFF',
	}
	if (type == 'video') {
		element.poster = videoPoster
		element.autoplay = false
		element.loop = false
		element.playbackRate = 1
	} else {
		element.invertX = 1
		element.invertY = 1
		if (imagePoster) {
			element.poster = imagePoster
		}
	}

	const refCommands = getCommandsToUpdateElementRefId(element) || []

	const commands = [
		addElementCommand({
			slideId: currentSlide.value.clientId,
			element: element,
		}),
		...refCommands,
	]

	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [element.id],
			commands,
		}),
	)
}

const replaceMediaElement = async (element, fileDoc) => {
	let commands = []

	if (element.src !== fileDoc.file_url) {
		commands.push(
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [element.id],
				property: 'src',
				oldValue: element.src,
				newValue: fileDoc.file_url,
			}),
		)
	}

	if (element.attachmentName !== fileDoc.name) {
		commands.push(
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [element.id],
				property: 'attachmentName',
				oldValue: element.attachmentName,
				newValue: fileDoc.name,
			}),
		)
	}

	if (element.type === 'video') {
		const oldPoster = element.poster
		const newPoster = await getVideoPoster(fileDoc.file_url)
		if (oldPoster !== newPoster) {
			commands.push(
				editElementCommand({
					slideId: currentSlide.value.clientId,
					elementIds: [element.id],
					property: 'poster',
					oldValue: oldPoster,
					newValue: newPoster,
				}),
			)
		}
	}

	// include any ref-id update commands produced by transition logic
	commands = commands.concat(getCommandsToUpdateElementRefId(element) || [])

	if (commands.length) {
		commandHistory.execute(
			batchCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [element.id],
				commands,
			}),
		)
	}
}

const duplicateElements = async (e, elements, srcSlide, toDisplace = true) => {
	e?.preventDefault()

	if (srcSlide == null) srcSlide = slideIndex.value

	const displaceByPx = srcSlide == slideIndex.value && toDisplace ? 40 : 0

	let commands = []
	let newSelection = []

	elements.forEach((element) => {
		let newElement = JSON.parse(JSON.stringify(element))
		newElement.id = generateUniqueId()
		newElement.zIndex = currentSlide.value.elements.length + 1
		newElement.top += displaceByPx
		newElement.left += displaceByPx

		commands.push(
			addElementCommand({
				slideId: currentSlide.value.clientId,
				element: newElement,
			}),
		)

		commands = commands.concat(getCommandsToInitElementRefId(newElement, element, srcSlide))

		newSelection.push(newElement.id)
	})

	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: newSelection,
			commands,
		}),
	)
}

const isFileDocUsed = (element) => {
	return slides.value.some((slide) => {
		if (!slide.elements) return false

		return slide.elements.some((el) => el.id !== element.id && el.src === element.src)
	})
}

const deleteAttachments = async (elements) => {
	elements.forEach((element) => {
		if (['image', 'video'].includes(element.type)) {
			if (isFileDocUsed(element)) return

			call('frappe.client.delete', {
				doctype: 'File',
				name: element.attachmentName,
			})
		}
	})
}

const deleteElements = async (e, ids) => {
	const idsToDelete = ids || activeElementIds.value
	await resetFocus()
	let commands = []

	idsToDelete.forEach((id) => {
		commands.push(
			removeElementCommand({
				slideId: currentSlide.value.clientId,
				element: currentSlide.value.elements.find((el) => el.id === id),
			}),
		)
	})

	const elementsCopy = JSON.parse(JSON.stringify(currentSlide.value.elements))
	const normalizedElements = normalizeZIndices(
		elementsCopy.filter((el) => !idsToDelete.includes(el.id)),
	)

	normalizedElements.forEach((el) => {
		commands.push(
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [el.id],
				property: 'zIndex',
				oldValue: currentSlide.value.elements.find((e) => e.id === el.id).zIndex,
				newValue: el.zIndex,
			}),
		)
	})

	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: idsToDelete,
			commands,
		}),
	)
}

const selectAllElements = (e) => {
	e.preventDefault()
	activeElementIds.value = currentSlide.value.elements.map((element) => element.id)
}

const resetFocus = () => {
	if (!activeElementIds.value.length) return

	activeElementIds.value = []
	focusElementId.value = null
	pairElementId.value = null
}

const getElementPosition = (elementId) => {
	const elementDiv = getElementDiv(elementId)
	if (!elementDiv) return { left: 0, top: 0, right: 0, bottom: 0 }

	const elementRect = elementDiv.getBoundingClientRect()

	const elementLeft = (elementRect.left - slideBounds.left) / slideBounds.scale
	const elementTop = (elementRect.top - slideBounds.top) / slideBounds.scale
	const elementRight = elementLeft + elementRect.width / slideBounds.scale
	const elementBottom = elementTop + elementRect.height / slideBounds.scale

	return {
		left: elementLeft,
		top: elementTop,
		right: elementRight,
		bottom: elementBottom,
	}
}

const getElementLayoutPosition = (element) => {
	const elementDiv = getElementDiv(element.id)
	// no rendered node yet: fall back to the element's stored bounds
	if (!elementDiv) {
		return {
			left: element.left,
			top: element.top,
			right: element.left + (element.width || 0),
			bottom: element.top + (element.height || 0),
		}
	}

	return {
		left: element.left,
		top: element.top,
		right: element.left + elementDiv.offsetWidth,
		bottom: element.top + elementDiv.offsetHeight,
	}
}

const isWithinOverlappingBounds = (outer, inner) => {
	const { left: outerLeft, top: outerTop, right: outerRight, bottom: outerBottom } = outer
	const { left: innerLeft, top: innerTop, right: innerRight, bottom: innerBottom } = inner

	const withinWidth =
		(outerRight >= innerLeft && outerLeft <= innerLeft) ||
		(innerRight >= outerLeft && innerLeft <= outerLeft)

	const withinHeight =
		(outerBottom >= innerTop && outerTop <= innerTop) ||
		(innerBottom >= outerTop && innerTop <= outerTop)

	return withinWidth && withinHeight
}

const addFixedWidthToElement = () => {
	const elementDiv = getElementDiv(activeElement.value.id)
	if (elementDiv) {
		const rect = elementDiv.getBoundingClientRect()
		activeElement.value.width = rect.width / slideBounds.scale
		markDirty()
	}
}

const { initTextEditor, activeEditor } = useTextEditor()
let editorOldText = ''

const getEditorHTML = () => {
	const html = activeEditor.value.getHTML()
	return patchEmptyParagraphs(html)
}

const updateElementContent = (element) => {
	const { wasUpdated, updatedHTML } = getEditorHTML()
	const currentText = activeEditor.value.getText()

	if (editorOldText == currentText && !wasUpdated) return

	const refCommands = getCommandsToUpdateElementRefId(element) || []
	if (refCommands.length) {
		commandHistory.execute(
			batchCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [element.id],
				commands: refCommands,
				// runs while blurring away from the element, must not steal selection
				skipJumpOnExecute: true,
			}),
		)
	}

	element.content = updatedHTML
	editorOldText = currentText

	markDirty()
}

const blurAndSaveContent = (element) => {
	activeEditor.value.setEditable(false)
	activeEditor.value.commands.blur()

	const isEmpty = (activeEditor.value?.getText() || '').replace(/\u200B/g, '') === ''

	if (!isEmpty) return updateElementContent(element)

	if (element.type === 'shape') {
		if (element.content) {
			element.content = null
			markDirty()
		}
	} else {
		deleteElements(null, [element.id])
	}
}

const setEditableState = () => {
	activeEditor.value.setEditable(true)
	activeEditor.value.commands.focus()
	activeEditor.value.commands.setTextSelection({
		from: 0,
		to: activeEditor.value.state.doc.content.size,
	})
}

const initEditorForElement = (element) => {
	if (element?.type == 'text') {
		const isEditable = focusElementId.value == element.id
		initTextEditor(element.id, element.content, isEditable, element.editorMetadata?.lineHeight)

		if (isEditable) setEditableState()
	}
}

const findSlideElement = (id) => currentSlide.value?.elements.find((el) => el.id === id)

const replaceEditor = (fn) =>
	nextTick(() => {
		activeEditor.value?.destroy()
		activeEditor.value = null
		fn?.()
		editorOldText = activeEditor.value?.getText()
	})

const initShapeEditor = (element) =>
	replaceEditor(() => {
		initTextEditor(element.id, element.content || getInitialShapeTextContent(element), true)
		setEditableState()
	})

watch(
	() => activeElement.value,
	(element, oldElement) => {
		if (['text', 'shape'].includes(oldElement?.type) && activeEditor.value) {
			blurAndSaveContent(oldElement)
		}
		replaceEditor(() => initEditorForElement(element))
	},
)

// focusElementId changing to a shape's id enters text-edit mode for that shape.
// The activeElement watch won't fire then (same element object), so this handles it.
// Also handles the inverse: focusElementId cleared while still on the same shape (Escape).
watch(
	() => focusElementId.value,
	(id, oldId) => {
		if (id) {
			const element = findSlideElement(id)
			if (element?.type === 'shape') initShapeEditor(element)
		} else if (oldId && activeEditor.value) {
			if (activeElement.value?.id !== oldId) return
			const oldElement = findSlideElement(oldId)
			if (oldElement?.type !== 'shape') return
			blurAndSaveContent(oldElement)
			replaceEditor()
		}
	},
)

const normalizeZIndices = (elements) => {
	const els = cloneObj(elements).sort((a, b) => {
		const zIndexA = a.zIndex || 1
		const zIndexB = b.zIndex || 1

		return zIndexA - zIndexB
	})

	els.forEach((el, index) => {
		el.zIndex = index + 1
	})

	elements.forEach((el) => {
		const updatedElement = els.find((e) => e.id == el.id)
		el.zIndex = updatedElement.zIndex
	})

	return elements
}

const findElement = (state, slideId, elementId) => {
	const slide = state.find((s) => s.clientId === slideId)
	if (!slide) return null

	return slide.elements.find((el) => el.id === elementId)
}

const cropSelectionToFitContent = (elementIds) => {
	let l = 10000,
		t = 10000,
		r = 0,
		b = 0

	// crop selection to selected element edges
	elementIds.forEach((id) => {
		const element = currentSlide.value.elements.find((el) => el.id === id)
		const useLayoutBounds = elementIds.length == 1 && ['shape', 'image'].includes(element?.type)

		const {
			left: elementLeft,
			top: elementTop,
			right: elementRight,
			bottom: elementBottom,
		} = useLayoutBounds ? getElementLayoutPosition(element) : getElementPosition(id)

		if (elementLeft < l) l = elementLeft
		if (elementTop < t) t = elementTop
		if (elementRight > r) r = elementRight
		if (elementBottom > b) b = elementBottom
	})

	updateSelectionBounds({
		left: l,
		top: t,
		width: r - l,
		height: b - t,
	})
}

const updatePosition = (axis, value) => {
	const property = axis == 'X' ? 'left' : 'top'
	const delta = value - selectionBounds[property]

	const commands = activeElements.value.map((element) =>
		editElementCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [element.id],
			property,
			oldValue: element[property],
			newValue: element[property] + delta,
		}),
	)

	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: activeElementIds.value,
			commands,
		}),
	)

	selectionBounds[property] = value
}

const updateDimension = (axis, value) => {
	const property = axis == 'W' ? 'width' : 'height'
	const numericValue = Number(value)

	if (!Number.isFinite(numericValue) || numericValue < 1) return
	if (property == 'height' && activeElements.value.some((element) => element.type != 'shape'))
		return

	const delta = numericValue - selectionBounds[property]

	const commands = activeElements.value.map((element) => {
		const oldValue = element[property] ?? selectionBounds[property]

		return editElementCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [element.id],
			property,
			oldValue: element[property],
			newValue: oldValue + delta,
		})
	})

	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: activeElementIds.value,
			commands,
		}),
	)

	selectionBounds[property] = numericValue
}

const getElementCenter = (axis) => {
	let elementStart, elementSize, slideStart

	if (axis == 'Y') {
		elementStart = selectionBounds.left
		elementSize = selectionBounds.width
		slideStart = slideBounds.left
	} else {
		elementStart = selectionBounds.top
		elementSize = selectionBounds.height
		slideStart = slideBounds.top
	}

	elementStart = elementStart * slideBounds.scale + slideStart
	elementSize *= slideBounds.scale

	return elementStart + elementSize / 2
}

export {
	activeElementIds,
	focusElementId,
	pairElementId,
	pendingShapeType,
	activeElements,
	activeElement,
	setActiveElements,
	resetFocus,
	addTextElement,
	addMediaElement,
	addShapeElement,
	duplicateElements,
	deleteElements,
	selectAllElements,
	getElementPosition,
	addFixedWidthToElement,
	deleteAttachments,
	setEditableState,
	replaceMediaElement,
	normalizeZIndices,
	isWithinOverlappingBounds,
	updatePosition,
	updateDimension,
	findElement,
	cropSelectionToFitContent,
	getElementCenter,
}
