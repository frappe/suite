import { ref, computed, nextTick, watch } from 'vue'
import { call } from 'frappe-ui'

import {
	selectionBounds,
	slides,
	slideBounds,
	updateSelectionBounds,
	currentSlide,
	slideIndex,
} from './slide'
import { useTextEditor, resetGrowthBaseline } from '@/apps/slides/composables/useTextEditor'

import { getElementDiv } from './elementRegistry'
import { markDirty } from './saving'
import { generateUniqueId, cloneObj } from '../utils/helpers'
import { getBorderInset, getCoverCrop, isFullRect } from '../utils/cropGeometry'
import { getMinSizeForElement } from '../utils/resize'
import { getBoundTargetIds, getLineBox, remapElementIds } from '../utils/connectors'
import { getAttachmentUrl } from '../utils/mediaUploads'
import { guessTextColorFromBackground, guessShapeColorsFromBackground } from '../utils/color'
import { presentationId } from './presentation'
import { getCommandsToInitElementRefId, getCommandsToUpdateElementRefId } from './transition'
import { commandHistory } from './historyMeta'

import { generateHTML } from '@tiptap/core'
import { ZWSP, extensions, hasTableNode, patchEmptyParagraphs } from '@/apps/slides/stores/tiptapSetup'
import {
	editElementCommand,
	batchCommand,
	addElementCommand,
	removeElementCommand,
} from '@/apps/slides/stores/commands'
import { interactionOffset, markTurnedFixed } from '@/apps/slides/stores/interaction'

const findSlideElement = (id) => currentSlide.value?.elements.find((el) => el.id === id)

const activeElementIds = ref([])
const focusElementId = ref(null)
const pairElementId = ref(null)
const pendingShapeType = ref(null)
// markers / route picked from the toolbar, applied to the next drawn shape
const pendingShapePreset = ref({})

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

const getInitialTableContent = (rows, cols, columnWidth, cellStyles) => {
	// marks need text to sit on, so an empty cell has nothing to style
	const placeholder = {
		type: 'text',
		text: ZWSP,
		marks: [{ type: 'textStyle', attrs: cellStyles }],
	}

	const getCell = (type) => ({
		type,
		attrs: { colspan: 1, rowspan: 1, colwidth: [columnWidth] },
		content: [
			{ type: 'paragraph', attrs: { textAlign: 'left', lineHeight: 1.5 }, content: [placeholder] },
		],
	})

	const getRow = (cellType) => ({
		type: 'tableRow',
		content: Array.from({ length: cols }, () => getCell(cellType)),
	})

	const tableRows = [getRow('tableHeader')]
	while (tableRows.length < rows) tableRows.push(getRow('tableCell'))

	const contentJSON = {
		type: 'doc',
		content: [{ type: 'table', content: tableRows }],
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

// arrows chosen on the last line / connector become the next one's default
const lastMarkers = {
	line: { markerStart: 'none', markerEnd: 'none' },
	connector: { markerStart: 'none', markerEnd: 'arrow' },
}

const rememberMarkers = (element) => {
	const tool = element.connector ? 'connector' : 'line'
	lastMarkers[tool] = { markerStart: element.markerStart, markerEnd: element.markerEnd }
}

const getShapeDefaults = (shapeType) => {
	let width, height, strokeColor, strokeWidth, borderRadius, elementShapeType
	const { markerStart, markerEnd } = lastMarkers[shapeType] ?? lastMarkers.line

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
		case 'connector':
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

const addShapeElement = async (shapeType, bounds = null, overrides = {}) => {
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
		const { x1, y1, x2, y2 } = bounds
		bounds = getLineBox({ x: x1, y: y1 }, { x: x2, y: y2 }, strokeWidth)
	}

	const width = bounds?.width ?? defaultWidth
	const height = elementShapeType === 'line' ? strokeWidth : (bounds?.height ?? defaultHeight)
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
		...overrides,
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

	// the element's own markup and CSS, or the measurement drifts by sub-pixels
	tempTextElement.className = 'textElement text-auto-width'
	Object.assign(tempTextElement.style, {
		position: 'absolute',
		visibility: 'hidden',
	})
	tempTextElement.innerHTML = getElementContent(presets)

	document.body.appendChild(tempTextElement)

	// fractional, to agree with the selection bounds the resize observer writes
	const { width: elementWidth, height: elementHeight } = tempTextElement.getBoundingClientRect()

	document.body.removeChild(tempTextElement)

	return { elementWidth, elementHeight }
}

const addTextElement = async (text, position) => {
	const elementPresets = {
		textAlign: 'center',
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

const addTableElement = async (rows = 3, cols = 3) => {
	// a table states its own width, so one wider than the slide is placed hanging
	// off both edges instead of being fitted to it
	const slideWidth = slideBounds.width / slideBounds.scale
	const columnWidth = Math.min(150, Math.floor(slideWidth / cols))
	const width = cols * columnWidth

	// rows size themselves to their content, so this only places the new element
	const position = getLeftTopForCenteredElement(width, rows * 40)

	const cellStyles = {
		fontSize: 18,
		fontFamily: 'Inter',
		color: guessTextColorFromBackground(currentSlide.value.background),
		letterSpacing: 0,
		opacity: 100,
	}

	const element = {
		id: generateUniqueId(),
		zIndex: currentSlide.value.elements.length + 1,
		left: position.left,
		top: position.top,
		width,
		opacity: 100,
		type: 'table',
		color: cellStyles.color,
		content: getInitialTableContent(rows, cols, columnWidth, cellStyles),
	}

	const refCommands = getCommandsToUpdateElementRefId(element) || []

	const commands = [
		addElementCommand({
			slideId: currentSlide.value.clientId,
			element: element,
		}),
		...refCommands,
	]

	// tables open selected, not focused: editing starts on double-click
	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [element.id],
			commands,
		}),
	)
}

// createResource hands back the last poster it saved when a request fails, which
// silently pins the wrong one on a slow network
const savePoster = async (posterDataUrl) => {
	try {
		return await call('suite.slides.doctype.presentation.presentation.save_base64_image', {
			presentation_name: presentationId.value,
			base64_data: posterDataUrl,
			prefix: 'poster',
		})
	} catch (error) {
		// the media is worth keeping without a poster
		console.error('Could not save poster', error)
		return null
	}
}

// a full bleed poster needs twice the 960px slide to stay sharp, and no more, so
// encoding the frame at the media's own resolution only makes the upload slower
const POSTER_MAX_EDGE = 1920
const POSTER_QUALITY = 0.8

const captureMediaFrame = (media, width, height) => {
	const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(width, height))

	const canvas = document.createElement('canvas')
	canvas.width = Math.round(width * scale)
	canvas.height = Math.round(height * scale)

	const context = canvas.getContext('2d')
	context.drawImage(media, 0, 0, canvas.width, canvas.height)

	return canvas.toDataURL('image/webp', POSTER_QUALITY)
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

	return await savePoster(captureMediaFrame(img, img.naturalWidth, img.naturalHeight))
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

// the frame is read locally, so how the element is sized never waits on the network
const handleVideoCloneDataLoad = (videoClone, resolve, reject) => {
	try {
		resolve({
			frame: captureMediaFrame(videoClone, videoClone.videoWidth, videoClone.videoHeight),
			aspectRatio: videoClone.videoWidth / videoClone.videoHeight,
		})
	} catch (err) {
		reject(err)
	} finally {
		videoClone.remove()
	}
}

// reading the frame back off the server re-downloads the whole upload, so the
// file still in hand is what gets probed
const getProbeUrl = (src, localFile) =>
	localFile ? URL.createObjectURL(localFile) : getAttachmentUrl(src)

const revokeProbeUrl = (url) => {
	if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

const captureVideoFrame = async (videoUrl) => {
	return new Promise((resolve, reject) => {
		// create a clone of the video element to generate a poster
		// without making the original video visible so there's no flicker
		const videoClone = getVideoElementClone(videoUrl)
		document.body.appendChild(videoClone)

		// loadeddata fires before the first frame is decoded on a slow link, which
		// captures an empty canvas; a completed seek guarantees the frame is there
		videoClone.addEventListener('loadeddata', () => (videoClone.currentTime = 0.05), {
			once: true,
		})

		videoClone.addEventListener(
			'seeked',
			() => handleVideoCloneDataLoad(videoClone, resolve, reject),
			{ once: true },
		)

		videoClone.addEventListener(
			'error',
			() => {
				videoClone.remove()
				reject(new Error('Failed to load video for frame capture'))
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

const addMediaElement = async (file, type, targetSlide, localFile) => {
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
		const videoUrl = getProbeUrl(src, localFile)
		try {
			const { frame, aspectRatio } = await captureVideoFrame(videoUrl)
			elementHeight = elementWidth / aspectRatio
			videoPoster = await savePoster(frame)
		} catch {
			// the video is worth keeping without a poster; it plays either way
			elementHeight = elementWidth * (9 / 16)
		} finally {
			revokeProbeUrl(videoUrl)
		}
		position = getLeftTopForCenteredElement(elementWidth, elementHeight)
	}

	// a slow upload can outlive a slide switch, so the element goes back to the
	// slide it was started from, not to whatever is on screen now
	const slideIdx = slides.value.indexOf(targetSlide)
	if (slideIdx === -1) return

	let element = {
		id: generateUniqueId(),
		zIndex: targetSlide.elements.length + 1,
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

	const refCommands = getCommandsToUpdateElementRefId(element, slideIdx) || []

	const commands = [
		addElementCommand({
			slideId: targetSlide.clientId,
			element: element,
		}),
		...refCommands,
	]

	commandHistory.execute(
		batchCommand({
			slideId: targetSlide.clientId,
			elementIds: [element.id],
			commands,
			skipJumpOnExecute: targetSlide !== currentSlide.value,
		}),
	)
}

const probeReplacementMedia = async (element, fileDoc, localFile) => {
	const newUrl = getAttachmentUrl(fileDoc.file_url)

	if (element.type === 'video') {
		const videoUrl = getProbeUrl(fileDoc.file_url, localFile)
		try {
			const { frame, aspectRatio } = await captureVideoFrame(videoUrl)
			return { poster: await savePoster(frame), aspect: aspectRatio }
		} catch {
			// the old poster belongs to the video being replaced, so it goes either way
			return { poster: null }
		} finally {
			revokeProbeUrl(videoUrl)
		}
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

const replaceMediaElement = async (element, fileDoc, localFile) => {
	// measure while the old media is still rendered, before any await
	const frameHeight = element.height || getElementDiv(element.id)?.offsetHeight

	const srcChanged = element.src !== fileDoc.file_url
	const probes = srcChanged ? await probeReplacementMedia(element, fileDoc, localFile) : null

	// a slow upload can outlive a slide switch or the element itself, and older
	// presentations repeat one layout's element ids across slides, so only the
	// element object itself names the slide to edit
	const slideIdx = slides.value.findIndex((s) => s.elements.includes(element))
	if (slideIdx === -1) return
	const slideId = slides.value[slideIdx].clientId

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
	commands = commands.concat(getCommandsToUpdateElementRefId(element, slideIdx) || [])

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
	const copies = remapElementIds(
		sortedElements.map((element) => JSON.parse(JSON.stringify(element))),
	)

	sortedElements.forEach((element, index) => {
		const newElement = copies[index]
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

// a connector lets go of a deleted target, and goes along when all of them go
const getDetachCommands = (idsToDelete) => {
	const commands = []
	const orphaned = []
	currentSlide.value.elements.forEach((element) => {
		if (idsToDelete.includes(element.id)) return
		const boundIds = getBoundTargetIds(element.connector)
		if (!boundIds.some((id) => idsToDelete.includes(id))) return
		const bothDeleted =
			element.connector.start &&
			element.connector.end &&
			boundIds.every((id) => idsToDelete.includes(id))
		if (bothDeleted && !element.locked) return orphaned.push(element.id)
		const connector = { ...element.connector }
		;['start', 'end'].forEach((end) => {
			if (idsToDelete.includes(connector[end]?.elementId)) connector[end] = null
		})
		commands.push(
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [element.id],
				property: 'connector',
				oldValue: element.connector,
				newValue: connector,
				bypassLock: true,
			}),
		)
	})
	return { commands, orphaned }
}

const hasBoundConnector = computed(() =>
	activeElements.value.some((element) => getBoundTargetIds(element.connector).length),
)

const disconnectConnectors = () => {
	const commands = activeElements.value
		.filter((element) => !element.locked && getBoundTargetIds(element.connector).length)
		.map((element) =>
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [element.id],
				property: 'connector',
				oldValue: element.connector,
				newValue: { ...element.connector, start: null, end: null },
			}),
		)
	if (!commands.length) return
	commandHistory.execute(
		batchCommand({
			slideId: currentSlide.value.clientId,
			elementIds: activeElementIds.value,
			commands,
		}),
	)
}

const deleteElements = (e, ids) => {
	const targetIds = (ids || activeElementIds.value).filter((id) => !findSlideElement(id)?.locked)
	if (!targetIds.length) return
	resetFocus()
	const detach = getDetachCommands(targetIds)
	const idsToDelete = [...targetIds, ...detach.orphaned]
	let commands = [...detach.commands]

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

	// a gesture in flight rides on a transform, so the rendered position is
	// left/top plus the offset, which is what SelectionBox subtracts back out
	const left = element.left + interactionOffset.left
	const top = element.top + interactionOffset.top

	// no rendered node yet: fall back to the element's stored bounds
	if (!elementDiv) {
		return {
			left,
			top,
			right: left + (element.width || 0),
			bottom: top + (element.height || 0),
		}
	}

	return {
		left,
		top,
		right: left + elementDiv.offsetWidth,
		bottom: top + elementDiv.offsetHeight,
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

const getRenderedWidth = (elementId) => {
	const elementDiv = getElementDiv(elementId)
	if (!elementDiv) return null
	return elementDiv.getBoundingClientRect().width / slideBounds.scale
}

// the gesture that triggered this records the conversion, so undo reaches auto
const addFixedWidthToElement = () => {
	const width = getRenderedWidth(activeElement.value.id)
	if (width == null) return

	markTurnedFixed(activeElement.value.id)
	activeElement.value.width = width
	markDirty()
}

// only centered and right-aligned text pays a width change out of its left
const getAnchorFactor = (elementDiv) => {
	const blocks = [...elementDiv.querySelectorAll('p')]
	const aligns = new Set(blocks.map((block) => getComputedStyle(block).textAlign))
	if (aligns.size !== 1) return 0

	const align = aligns.values().next().value
	if (align === 'center') return 0.5
	return align === 'right' ? 1 : 0
}

const setFixedWidth = () => {
	const element = activeElement.value
	if (!element || element.width) return

	const width = getRenderedWidth(element.id)
	if (width == null) return

	commandHistory.execute(
		editElementCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [element.id],
			property: 'width',
			oldValue: null,
			newValue: width,
		}),
	)
	resetGrowthBaseline()
}

const setAutoWidth = async () => {
	const element = activeElement.value
	if (!element?.width) return

	const slideId = currentSlide.value.clientId
	const elementDiv = getElementDiv(element.id)
	const width = element.width
	const commands = [
		editElementCommand({
			slideId,
			elementIds: [element.id],
			property: 'width',
			oldValue: width,
			newValue: null,
		}),
	]

	const anchorFactor = elementDiv ? getAnchorFactor(elementDiv) : 0
	if (anchorFactor) {
		// the auto width is only knowable from the element itself, so borrow it
		// for a tick; the command below is what actually applies the change
		const left = element.left
		element.width = null
		await nextTick()
		const autoWidth = getRenderedWidth(element.id) ?? width
		element.width = width

		commands.push(
			editElementCommand({
				slideId,
				elementIds: [element.id],
				property: 'left',
				oldValue: left,
				newValue: left + (width - autoWidth) * anchorFactor,
			}),
		)
	}

	commandHistory.execute(batchCommand({ slideId, elementIds: [element.id], commands }))
	await resetGrowthBaseline()
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
	const { updatedHTML } = getEditorHTML()
	const currentText = activeEditor.value.getText()

	// legacy content keeps needing the patch, so idempotence has to come from
	// comparing against what is stored, or a second blur-save runs the refId
	// pairing again after the slide index has already moved on
	if (editorOldText == currentText && element.content == updatedHTML) return

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

// empty cells are still a table, only a deleted one leaves nothing to edit
const isEditorEmpty = (element) => {
	if (element.type === 'table') return !hasTableNode(activeEditor.value.state.doc)
	// indentation survives the parse now, so a box holding nothing else has to keep
	// reading as the empty one it looks like. the line breaks stay, or a box of
	// blank lines starts reading as empty too
	return !activeEditor.value.getText().replace(/[\u200B\t ]/g, '')
}

const blurAndSaveContent = (element) => {
	activeEditor.value.setEditable(false)
	// blur() drops the window selection, including one this editor never held
	if (activeEditor.value.isFocused) activeEditor.value.commands.blur()

	if (!isEditorEmpty(element)) return updateElementContent(element)

	if (element.type === 'shape') {
		if (element.content) {
			element.content = null
			markDirty()
		}
	} else {
		deleteElements(null, [element.id])
	}
}

// the watches below only fire after the slide has already changed, so leaving
// a slide has to save the open editor while its element is still reachable
const flushPendingBlur = () => {
	const element = activeElement.value
	if (!activeEditor.value || !['text', 'table', 'shape'].includes(element?.type)) return
	blurAndSaveContent(element)
}

const setEditableState = () => {
	activeEditor.value.setEditable(true)
	activeEditor.value.commands.focus()

	// selecting the whole doc of a table selects every cell
	if (activeElement.value?.type === 'table') return

	activeEditor.value.commands.setTextSelection({
		from: 0,
		to: activeEditor.value.state.doc.content.size,
	})
}

// `text` replaces the content, like typing over a full selection
const startTextEditing = (text = '') => {
	const element = activeElement.value
	focusElementId.value = element.id

	if (element.type === 'text') {
		if (!activeEditor.value) return
		setEditableState()
		if (text) activeEditor.value.commands.insertContent(text)
		return
	}
	if (!text) return

	// a shape's editor is created on the next tick and selects all once mounted
	const stop = watch(activeEditor, (editor) => {
		if (!editor) return
		stop()
		editor.on('create', () => editor.commands.insertContent(text))
	})
}

const initEditorForElement = (element) => {
	if (['text', 'table'].includes(element?.type)) {
		initTextEditor(
			element.id,
			element.content,
			focusElementId.value == element.id,
			element.locked ? null : element.editorMetadata?.lineHeight,
		)
	}
}

// dropping the old editor before the next render keeps EditorContent from
// mounting onto an editor that is about to be destroyed
const replaceEditor = (fn) => {
	activeEditor.value?.destroy()
	activeEditor.value = null

	return nextTick(() => {
		fn?.()
		editorOldText = activeEditor.value?.getText()
	})
}

const initShapeEditor = (element) =>
	replaceEditor(() =>
		initTextEditor(element.id, element.content || getInitialShapeTextContent(element), true),
	)

watch(
	() => activeElement.value,
	(element, oldElement) => {
		if (['text', 'table', 'shape'].includes(oldElement?.type) && activeEditor.value) {
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
			if (!['text', 'table', 'shape'].includes(oldElement?.type)) return
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
	// every caller defers this, so the elements it names can be gone by now
	if (!elementIds.every((id) => findSlideElement(id))) return

	let l = 10000,
		t = 10000,
		r = 0,
		b = 0

	// a connector whose ends both sit on selected targets adds nothing to the box
	const isRoutedWithin = (element) => {
		const boundIds = getBoundTargetIds(element.connector)
		return boundIds.length == 2 && boundIds.every((id) => elementIds.includes(id))
	}
	const boundedIds = elementIds.filter((id) => !isRoutedWithin(findSlideElement(id)))

	// crop selection to selected element edges
	boundedIds.forEach((id) => {
		const element = currentSlide.value.elements.find((el) => el.id === id)
		// same source the resize observer writes from, so the two never disagree by a sub-pixel
		const useLayoutBounds = boundedIds.length == 1

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

const flipElements = (direction) => {
	if (isSelectionLocked.value) return

	const property = direction == 'horizontal' ? 'invertX' : 'invertY'

	const flippable = activeElements.value.filter(
		(element) => !getBoundTargetIds(element.connector).length && !element.points,
	)
	const commands = flippable.map((element) => {
		const current = element[property]
		return editElementCommand({
			slideId: currentSlide.value.clientId,
			elementIds: [element.id],
			property,
			oldValue: current,
			newValue: !current || current == 1 ? -1 : 1,
		})
	})
	if (!commands.length) return

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
	pendingShapePreset,
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
	flushPendingBlur,
	exitTextEditing,
	addTextElement,
	addMediaElement,
	addShapeElement,
	addTableElement,
	duplicateElements,
	deleteElements,
	hasBoundConnector,
	disconnectConnectors,
	selectAllElements,
	selectableIds,
	getElementPosition,
	addFixedWidthToElement,
	setFixedWidth,
	setAutoWidth,
	ensureExplicitHeight,
	getNaturalAspectRatio,
	setEditableState,
	startTextEditing,
	replaceMediaElement,
	normalizeZIndices,
	isWithinOverlappingBounds,
	flipElements,
	findSlideElement,
	getInitialShapeTextContent,
	getInitialTableContent,
	cropSelectionToFitContent,
	getElementCenter,
	getShapeDefaults,
	rememberMarkers,
}
