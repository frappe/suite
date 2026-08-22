import { ref } from 'vue'
import { toast, call } from 'frappe-ui'

import { presentationId } from '@/apps/slides/stores/presentation'
import { slideIndex, insertSlide, getNewSlide } from '@/apps/slides/stores/slide'
import {
	activeElements,
	activeElementIds,
	focusElementId,
	addTextElement,
	duplicateElements,
	resetFocus,
} from '@/apps/slides/stores/element'

import { inCropMode } from '@/apps/slides/stores/imageCrop'
import { useTextEditor } from '@/apps/slides/composables/useTextEditor'

import { getDocFromHTML } from '@/apps/slides/utils/helpers'
import { remapElementIds } from '@/apps/slides/utils/connectors'
import { v4 as uuid4 } from 'uuid'
import { handleUploadedMedia } from '@/apps/slides/utils/mediaUploads'

const { activeEditor } = useTextEditor()

// Copy Handlers

const isCopyTriggeredByButton = ref(false)

// the source travels with the payload: a copy in one tab is pasted in another
const getCopiedElementsJSON = () =>
	JSON.stringify({
		srcPresentation: presentationId.value,
		srcSlide: slideIndex.value,
		elements: activeElements.value,
	})

const getCopiedSlideJSON = () => {
	const slide = getNewSlide(true)
	return JSON.stringify(slide)
}

const copySlide = (e) => {
	const clipboardJSON = getCopiedSlideJSON()
	e.clipboardData.setData('application/json', clipboardJSON)
	toast.success('Slide copied to clipboard')
}

const copyElements = (e) => {
	const clipboardJSON = getCopiedElementsJSON()
	e.clipboardData.setData('application/json', clipboardJSON)
}

const handleCopy = (e) => {
	if (isCopyTriggeredByButton.value) return

	e.preventDefault()
	const isCopyingElements = activeElementIds.value.length > 0
	if (isCopyingElements) {
		copyElements(e)
	} else {
		copySlide(e)
	}
}

const copyToClipboard = async (text) => {
	isCopyTriggeredByButton.value = true

	if (navigator.clipboard && window.isSecureContext) {
		await navigator.clipboard.writeText(text)
	} else {
		let input = document.createElement('textarea')
		document.body.appendChild(input)
		input.value = text
		input.select()
		document.execCommand('copy')
		document.body.removeChild(input)
	}

	isCopyTriggeredByButton.value = false
	toast.success('Copied to clipboard')
}

// Paste Handlers

const handlePastedText = async (clipboardText) => {
	await resetFocus()
	addTextElement(clipboardText)
}

const handlePastedJSON = async ({ srcPresentation, srcSlide, elements }) => {
	const pastedArray = Array.isArray(elements) ? elements : []

	if (
		pastedArray[0]?.type == 'text' &&
		focusElementId.value &&
		focusElementId.value != pastedArray[0].id
	) {
		activeEditor.value.commands.insertContent(pastedArray[0].content)
		return
	}

	let json = pastedArray
	if (srcPresentation !== presentationId.value) {
		// if pasted elements are from a different presentation
		// add file attachments correctly to current presentation + update docnames in json
		json = await call('suite.slides.doctype.presentation.presentation.get_updated_json', {
			presentation: presentationId.value,
			elements: pastedArray,
		})
	}

	// a foreign slide index means nothing here, and there is no original to displace from
	const sameSource = srcPresentation === presentationId.value
	duplicateElements(null, json, sameSource ? srcSlide : null, sameSource)
}

const handleSvgText = (svgText) => {
	const svgBlob = new Blob([svgText], { type: 'image/svg+xml' })
	const svgFile = new File([svgBlob], 'pasted-image.svg', { type: 'image/svg+xml' })
	handleUploadedMedia([{ kind: 'file', getAsFile: () => svgFile }])
}

const handlePastedSlideJSON = async (slideJSON) => {
	const index = slideIndex.value

	if (slideJSON.parent != presentationId.value) {
		// if pasted slide is from a different presentation
		// add file attachments correctly to current presentation + update docnames in json
		slideJSON = await call(
			'suite.slides.doctype.presentation.presentation.update_slide_attachments',
			{
				parent: presentationId.value,
				slide: slideJSON,
			},
		)
		if (typeof slideJSON.elements === 'string') {
			slideJSON.elements = JSON.parse(slideJSON.elements)
		}
	}

	// Give each paste a fresh identity so repeated pastes don't share ids.
	// refId (cross-slide transition key) is intentionally kept.
	slideJSON.clientId = uuid4()
	slideJSON.elements = remapElementIds(slideJSON.elements || [])

	insertSlide(slideJSON, index)
}

const isInputElement = (el) => {
	const activeElement = document.activeElement
	return (
		activeElement?.tagName == 'INPUT' ||
		activeElement?.tagName == 'TEXTAREA' ||
		activeElement?.isContentEditable
	)
}

const handleClipboardText = (clipboardText) => {
	if (clipboardText?.trim().startsWith('<svg') && clipboardText?.trim().endsWith('</svg>')) {
		handleSvgText(clipboardText)
	} else if (clipboardText && !focusElementId.value) {
		handlePastedText(clipboardText)
	}
}

const handleClipboardJSON = async (clipboardJSON) => {
	const json = JSON.parse(clipboardJSON)
	if (json?.srcPresentation) return handlePastedJSON(json)
	if (json?.clientId) return handlePastedSlideJSON(json)
	// a bare array is the pre-source payload: no origin known, so attach as if foreign
	if (Array.isArray(json)) return handlePastedJSON({ srcPresentation: null, elements: json })
}

const dataURLToFile = (dataURL, filename) => {
	const [meta, base64] = dataURL.split(',')
	const mime = meta.match(/:(.*?);/)[1]
	const binary = atob(base64)
	const len = binary.length
	const buffer = new Uint8Array(len)

	for (let i = 0; i < len; i++) {
		buffer[i] = binary.charCodeAt(i)
	}

	return new File([buffer], filename, {
		type: mime,
		lastModified: Date.now(),
	})
}

const getImageSrcFromHTML = (clipboardTextHTML) => {
	const doc = getDocFromHTML(clipboardTextHTML)
	const img = doc.querySelector('img')

	if (img) return img.src
	return null
}

const handleClipboardTextHTML = (imgSrc) => {
	const file = dataURLToFile(imgSrc, 'pasted-image.png')
	handleUploadedMedia([{ kind: 'file', getAsFile: () => file }])
}

const handlePaste = (e) => {
	// do not override paste event if current element is input or content editable
	if (isInputElement()) return

	// a paste would steal the selection from the crop session mid-interaction
	if (inCropMode.value) return

	e.preventDefault()

	const clipboardTextHTML = e.clipboardData.getData('text/html')
	const imgSrc = getImageSrcFromHTML(clipboardTextHTML)
	if (clipboardTextHTML && imgSrc && imgSrc.startsWith('data:'))
		return handleClipboardTextHTML(imgSrc)

	const clipboardJSON = e.clipboardData.getData('application/json')
	if (clipboardJSON) return handleClipboardJSON(clipboardJSON)

	const clipboardText = e.clipboardData.getData('text/plain')
	if (clipboardText) return handleClipboardText(clipboardText)

	const clipboardItems = e.clipboardData.items
	if (clipboardItems) return handleUploadedMedia(clipboardItems)
}

export { handleCopy, handlePaste, copyToClipboard }
