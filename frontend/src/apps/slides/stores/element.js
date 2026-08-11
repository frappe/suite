import { ref, computed, nextTick, watch } from 'vue'
import { createResource } from 'frappe-ui'

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
import { generateUniqueId, cloneObj, normalizeRotation } from '../utils/helpers'
import { getBorderInset, getCoverCrop, isFullRect } from '../utils/cropGeometry'
import { getAttachmentUrl } from '../utils/mediaUploads'
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

const findSlideElement = (id) => currentSlide.value?.elements.find((el) => el.id === id)

const activeElementIds = ref([])
const focusElementId = ref(null)
const pairElementId = ref(null)
const pendingShapeType = ref(null)

// true once a gesture crosses the drag threshold
const dragOccurred = ref(false)

const activeElements = computed(() => {
	let elements = []
	currentSlide.value?.elements.forEach((element) => {
		if (activeElementIds.value.includes(element.id)) {
			elements.push(element)
		}
	})
	return elements
})

const isSelectionLocked = computed(
	() => activeElements.value.length > 0 && activeElements.value.every((el) => el.locked),
)

const hasLockedElements = computed(
	() => currentSlide.value?.elements.some((el) => el.locked) ?? false,
)

const hasUnlockedElements = computed(
	() => currentSlide.value?.elements.some((el) => !el.locked) ?? false,
)

const activeElement = computed(() => {
	if (focusElementId.value) {
		return currentSlide.value?.elements.find((element) => element.id === focusElementId.value)
	} else if (activeElementIds.value.length == 1) {
		return activeElements.value[0]
	}
})

const setActiveElements = (ids) => {
	if (ids.length == 1 && activeElementIds.value.includes(ids[0])) return
	activeElementIds.value = ids
	focusElementId.value = null
}

const setLocked = (elementIds, locked) => {
	// the command carries one oldValue for the whole batch, so only pass ids that change
	const idsToSet = elementIds.filter((id) => {
		const element = findSlideElement(id)
		return element && !!element.locked !== locked
	})
	if (!idsToSet.length) return

	commandHistory.execute(
		editElementCommand({
			slideId: currentSlide.value.clientId,
			elementIds: idsToSet,
			property: 'locked',
			oldValue: locked ? undefined : true,
			newValue: locked ? true : undefined,
		}),
	)
}

const toggleLock = async () => {
	const ids = [...activeElementIds.value]
	if (!ids.length) return

	const locking = !isSelectionLocked.value
	if (locking && focusElementId.value) {
		exitTextEditing()
		await nextTick()
	}

	setLocked(ids, locking)
}

const lockAll = () => setLocked((currentSlide.value?.elements || []).map((el) => el.id), true)

const unlockAll = () => setLocked((currentSlide.value?.elements || []).map((el) => el.id), false)

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

	const { fillColor, strokeColor: defaultStrokeColor } = guessShapeColorsFromBackground(
		currentSlide.value?.background,
	)

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
		rotation: normalizeRotation(Math.atan2(dy, dx) * (180 / Math.PI)),
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
		strokeStyle: 'solid',
		shadowColor: '#7C7C7CFF',
		shadowOpacity: 100,
		shadowBlur: 0,
		shadowOffset: 0,
		shadowAngle: 45,
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

const getNaturalAspectRatio = (src) => {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => resolve(img.naturalWidth / img.naturalHeight)
		img.onerror = reject
		img.src = src
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
	let elementHeight = 0

	let position = {
		left: 0,
		top: 0,
	}

	let videoPoster = null
	let imagePoster = null

	if (type == 'image') {
		const { width, aspectRatio } = await getNaturalSize(getAttachmentUrl(src))
		elementWidth = Math.max(Math.min(width, 800), 30)
		elementHeight = elementWidth / aspectRatio
		position = getLeftTopForCenteredElement(elementWidth, elementHeight)
		if (isGifFile(file)) {
			imagePoster = await generateImagePoster(getAttachmentUrl(src))
		}
	} else {
		elementWidth = 400
		const { posterURL, aspectRatio } = await getVideoPoster(getAttachmentUrl(src))
		elementHeight = elementWidth / aspectRatio
		position = getLeftTopForCenteredElement(elementWidth, elementHeight)
		videoPoster = posterURL
	}

	let element = {
		id: generateUniqueId(),
		zIndex: currentSlide.value.elements.length + 1,
		width: elementWidth,
		height: elementHeight,
		left: position.left,
		top: position.top,
		opacity: 100,
		type: type,
		src: src,
		attachmentName: file.name,
		borderStyle: 'none',
		borderWidth: 0,
		borderRadius: 0,
		borderColor: '#d2d2d2ff',
		shadowColor: '#7C7C7CFF',
		shadowOpacity: 100,
		shadowBlur: 0,
		shadowOffset: 0,
		shadowAngle: 45,
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

const probeReplacementMedia = async (element, fileDoc) => {
	const newUrl = getAttachmentUrl(fileDoc.file_url)

	if (element.type === 'video') {
		const { posterURL, aspectRatio } = await getVideoPoster(newUrl)
		return { poster: posterURL, aspect: aspectRatio }
	}

	return {
		newAspect: await getNaturalAspectRatio(newUrl),
		poster: isGifFile(fileDoc) ? await generateImagePoster(newUrl) : null,
	}
}

// the width stays put and the frame height refits the new video
const pushVideoReplaceEdits = (element, { frameHeight, poster, aspect }, pushEdit) => {
	if (element.poster !== poster) pushEdit('poster', element.poster, poster)

	if (frameHeight && Number.isFinite(aspect) && aspect > 0) {
		const inset = getBorderInset(element)
		const newHeight = (element.width - 2 * inset) / aspect + 2 * inset
		if (newHeight !== element.height) pushEdit('height', element.height, newHeight)
	}
}

// the frame stays put and the new image is cover-cropped into it
const pushImageReplaceEdits = (element, { frameHeight, newAspect, poster }, pushEdit) => {
	if (!element.height && frameHeight) pushEdit('height', element.height, frameHeight)

	const inset = getBorderInset(element)

	// without a height the frame aspect is NaN and getCoverCrop falls back to
	// the full rect, so a legacy element just keeps sizing itself
	const frameAspect = (element.width - 2 * inset) / (frameHeight - 2 * inset)
	const coverCrop = getCoverCrop(newAspect, frameAspect)
	const newCrop = isFullRect(coverCrop) ? undefined : coverCrop
	if (element.crop || newCrop) pushEdit('crop', element.crop, newCrop)

	const newPoster = poster ?? undefined
	if ((element.poster ?? undefined) !== newPoster) pushEdit('poster', element.poster, newPoster)
}

const replaceMediaElement = async (element, fileDoc) => {
	// measure while the old media is still rendered, before any await
	const frameHeight = element.height || getElementDiv(element.id)?.offsetHeight

	const srcChanged = element.src !== fileDoc.file_url
	const probes = srcChanged ? await probeReplacementMedia(element, fileDoc) : null

	// a slow upload can outlive a slide switch or the element itself
	const slide = slides.value.find((s) => s.elements.some((el) => el.id === element.id))
	if (!slide) return
	const slideId = slide.clientId

	let commands = []
	const pushEdit = (property, oldValue, newValue) => {
		commands.push(
			editElementCommand({ slideId, elementIds: [element.id], property, oldValue, newValue }),
		)
	}

	if (srcChanged) {
		pushEdit('src', element.src, fileDoc.file_url)
		if (element.type === 'video') pushVideoReplaceEdits(element, { frameHeight, ...probes }, pushEdit)
		if (element.type === 'image') pushImageReplaceEdits(element, { frameHeight, ...probes }, pushEdit)
	}

	if (element.attachmentName !== fileDoc.name) {
		pushEdit('attachmentName', element.attachmentName, fileDoc.name)
	}

	// include any ref-id update commands produced by transition logic
	commands = commands.concat(getCommandsToUpdateElementRefId(element) || [])

	if (commands.length) {
		commandHistory.execute(
			batchCommand({
				slideId,
				elementIds: [element.id],
				commands,
				skipJumpOnExecute: true,
			}),
		)
	}
}

const duplicateElements = async (e, elements, srcSlide, toDisplace = true) => {
	e?.preventDefault()

	if (!elements?.length) return

	if (srcSlide == null) srcSlide = slideIndex.value

	const displaceByPx = srcSlide == slideIndex.value && toDisplace ? 40 : 0

	let commands = []
	let newSelection = []

	const baseZIndex = currentSlide.value.elements.length
	const sortedElements = [...elements].sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1))

	sortedElements.forEach((element, index) => {
		let newElement = JSON.parse(JSON.stringify(element))
		newElement.id = generateUniqueId()
		delete newElement.locked
		newElement.zIndex = baseZIndex + index + 1
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

const deleteElements = async (e, ids) => {
	const idsToDelete = (ids || activeElementIds.value).filter((id) => !findSlideElement(id)?.locked)
	if (!idsToDelete.length) return
	await resetFocus()
	let commands = []

	idsToDelete.forEach((id) => {
		// re-entrant: the focusElementId and activeElement watches both blur an empty text element
		const element = currentSlide.value.elements.find((el) => el.id === id)
		if (!element) return
		commands.push(
			removeElementCommand({
				slideId: currentSlide.value.clientId,
				element,
			}),
		)
	})

	if (!commands.length) return

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

// a selection skips locked elements, unless that would leave nothing to select
const selectableIds = (ids) => {
	const unlocked = ids.filter((id) => !findSlideElement(id)?.locked)
	return unlocked.length ? unlocked : ids
}

const selectAllElements = (e) => {
	e?.preventDefault()
	activeElementIds.value = selectableIds(currentSlide.value.elements.map((el) => el.id))
}

const resetFocus = () => {
	if (!activeElementIds.value.length) return

	activeElementIds.value = []
	focusElementId.value = null
	pairElementId.value = null
}

// exit text editing but keep the element selected; the focusElementId
// watch tears down the editor
const exitTextEditing = () => {
	focusElementId.value = null
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

// the stored number equals what auto-height already renders, so no markDirty
const ensureExplicitHeight = (element) => {
	if (!element || !['image', 'video'].includes(element.type)) return
	if (element.height) return
	const elementDiv = getElementDiv(element.id)
	if (!elementDiv) return
	element.height = elementDiv.offsetHeight
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
		initTextEditor(
			element.id,
			element.content,
			isEditable,
			element.locked ? null : element.editorMetadata?.lineHeight,
		)

		if (isEditable) setEditableState()
	}
}

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
// Also handles the inverse: focusElementId cleared while the element stays selected (Escape).
watch(
	() => focusElementId.value,
	(id, oldId) => {
		if (id) {
			const element = findSlideElement(id)
			if (element?.type === 'shape') initShapeEditor(element)
		} else if (oldId && activeEditor.value) {
			if (activeElement.value?.id !== oldId) return
			const oldElement = findSlideElement(oldId)
			if (!['text', 'shape'].includes(oldElement?.type)) return
			blurAndSaveContent(oldElement)
			if (oldElement.type === 'shape') replaceEditor()
			else replaceEditor(() => initEditorForElement(findSlideElement(oldId)))
		}
	},
)

// undo and redo can set locked underneath an element that is already being
// edited, which no call-site guard covers
watch(
	() => !!focusElementId.value && !!findSlideElement(focusElementId.value)?.locked,
	(locked) => {
		if (locked) nextTick(exitTextEditing)
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

const flipElements = (direction) => {
	if (isSelectionLocked.value) return

	const property = direction == 'horizontal' ? 'invertX' : 'invertY'

	const commands = activeElements.value.map((element) => {
		const current = element[property]
		return editElementCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [element.id],
			property,
			oldValue: current,
			newValue: !current || current == 1 ? -1 : 1,
		})
	})

	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: activeElementIds.value,
			commands,
		}),
	)
}

const getElementCenter = (axis) => {
	let elementStart, elementSize, slideStart

	if (axis == 'X') {
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
	dragOccurred,
	activeElements,
	activeElement,
	isSelectionLocked,
	hasLockedElements,
	hasUnlockedElements,
	toggleLock,
	lockAll,
	unlockAll,
	setActiveElements,
	resetFocus,
	exitTextEditing,
	addTextElement,
	addMediaElement,
	addShapeElement,
	duplicateElements,
	deleteElements,
	selectAllElements,
	selectableIds,
	getElementPosition,
	addFixedWidthToElement,
	ensureExplicitHeight,
	getNaturalAspectRatio,
	setEditableState,
	replaceMediaElement,
	normalizeZIndices,
	isWithinOverlappingBounds,
	updatePosition,
	flipElements,
	findSlideElement,
	cropSelectionToFitContent,
	getElementCenter,
}
