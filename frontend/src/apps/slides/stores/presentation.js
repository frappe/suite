import { ref, computed } from 'vue'
import { createResource, call, createDocumentResource } from 'frappe-ui'

import { router } from '@/apps/slides/router'
import { slides } from './slide'
import { markClean, markDirty, getPresentationFromLocalDB } from './saving'
import { normalizeZIndices } from '@/apps/slides/stores/element'
import { v4 as uuid4 } from 'uuid'
import { commandHistory } from './historyMeta'

const isDriveInstalled = window.apps?.includes('drive') ?? false

const presentationDoc = ref()

const presentationId = ref('')

const applyReverseTransition = ref(false)

const createPresentationResource = createResource({
	url: 'suite.slides.doctype.presentation.presentation.create_presentation',
	method: 'POST',
	makeParams: (args) => {
		return {
			duplicate_from: args.duplicateFrom,
			template: args.template,
		}
	},
	transform: (doc) => {
		return {
			name: doc.name,
			title: doc.title,
			owner: doc.owner,
			creation: doc.creation,
			modified_by: doc.modified_by,
			modified: doc.modified,
			thumbnail: doc.thumbnail || '',
			slide_count: doc.slide_count || doc.slides?.length || 0,
		}
	},
})

const updatePresentationTitle = async (id, newTitle) => {
	return call('suite.slides.doctype.presentation.presentation.update_title', {
		name: id,
		title: newTitle,
	}).then((response) => {
		if (response) {
			return response
		} else {
			throw new Error('Failed to rename presentation')
		}
	})
}

const getElementDimensions = async (el) => {
	let width = 0,
		height = 0

	//render outside dom to get width
	const tempDiv = document.createElement('div')
	tempDiv.style.position = 'absolute'
	tempDiv.style.visibility = 'hidden'
	tempDiv.style.height = 'auto'
	tempDiv.style.lineHeight = el.lineHeight || '1.5'

	if (el.width) {
		tempDiv.style.width = `${el.width}px`
		tempDiv.style.whiteSpace = 'pre-wrap'
	} else {
		tempDiv.style.width = 'auto'
		tempDiv.style.whiteSpace = 'pre'
	}

	tempDiv.innerHTML = el.content || ''
	document.body.appendChild(tempDiv)

	await document.fonts.ready

	width = el.width || tempDiv.offsetWidth
	height = tempDiv.offsetHeight

	document.body.removeChild(tempDiv)

	return { width, height }
}

const transformElements = async (elements) => {
	const newEls = []

	for (const el of elements) {
		if (el.type !== 'text') {
			newEls.push(el)
			continue
		}

		if (el.transform === 'translate(-50%, -50%)') {
			const { width, height } = await getElementDimensions(el)

			newEls.push({
				...el,
				transform: 'none',
				transformOrigin: 'top left',
				left: el.left - width / 2,
				top: el.top - height / 2,
			})
		} else if (!('transform' in el)) {
			newEls.push({
				...el,
				transform: 'none',
				transformOrigin: 'top left',
			})
		} else {
			newEls.push(el)
		}
	}

	return newEls
}

const parseElements = (value) => {
	if (!value) return []

	let parsed = []
	if (Array.isArray(value)) {
		parsed = value
	} else if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value)
		} catch {
			return []
		}
	}

	parsed = parsed.map((el) => {
		if (el.type === 'text' && el.editorMetadata?.lineHeight) {
			// migrate legacy editorMetadata.lineHeight into element attribute
			const lh = el.editorMetadata.lineHeight
			el.lineHeight = lh
		}
		if (el.type === 'shape' && el.shapeType === 'circle') {
			// 'circle' was renamed to 'oval' to match the display name
			el.shapeType = 'oval'
		}
		return el
	})

	return normalizeZIndices(parsed)
}

// Rescue decks saved with duplicate client_ids. Returns true if anything changed.
const ensureUniqueClientIds = (slides) => {
	const seen = new Set()
	let repaired = false
	for (const slide of slides) {
		if (seen.has(slide.clientId)) {
			slide.clientId = uuid4()
			repaired = true
		}
		seen.add(slide.clientId)
	}
	return repaired
}

const slidesLength = ref(0)

const getPresentationResource = (name) => {
	let clientIdsRepaired = false
	return createDocumentResource({
		doctype: 'Presentation',
		name: name,
		auto: false,
		transform(doc) {
			for (const slide of doc.slides || []) {
				slide.elements = parseElements(slide.elements)
				slide.clientId = slide.client_id || uuid4()
				slide.transitionDuration = slide.transition_duration
				slide.fadeUnmatchedElements = slide.fade_unmatched_elements
				delete slide.thumbnail
				// remove the transition_duration field to avoid confusion
				delete slide.transition_duration
				delete slide.fade_unmatched_elements
				delete slide.client_id
			}
			clientIdsRepaired = ensureUniqueClientIds(doc.slides || [])
		},
		async onSuccess(doc) {
			slidesLength.value = doc.slides?.length || 0
			for (const slide of doc.slides || []) {
				slide.elements = await transformElements(slide.elements)
			}
			isPublicPresentation.value = Boolean(doc.is_public)

			// restore unsynced local edits, but only if the server hasn't moved past them
			const local = await getPresentationFromLocalDB(name)
			if (local?.dirty && local.baseModified === doc.modified) {
				const restored = JSON.parse(JSON.stringify(local.content))
				// local content skips the transform's repair, so dedup it here too
				ensureUniqueClientIds(restored)
				slides.value = restored
				slidesLength.value = slides.value.length
				markDirty()
				return
			}

			slides.value = JSON.parse(JSON.stringify(doc.slides || []))
			markClean()
			// persist the repair
			if (clientIdsRepaired) markDirty()
		},
	})
}

const getPublicPresentationResource = (name) => {
	return createResource({
		url: 'suite.slides.doctype.presentation.presentation.get_public_presentation',
		method: 'GET',
		auto: false,
		makeParams: () => {
			return { name: name }
		},
		transform(doc) {
			for (const slide of doc.slides || []) {
				slide.elements = parseElements(slide.elements)
				slide.clientId = slide.client_id || uuid4()
				slide.transitionDuration = slide.transition_duration
				slide.fadeUnmatchedElements = slide.fade_unmatched_elements
				delete slide.thumbnail
				// remove the transition_duration field to avoid confusion
				delete slide.transition_duration
				delete slide.fade_unmatched_elements
				delete slide.client_id
			}
			ensureUniqueClientIds(doc.slides || [])
		},
		onSuccess(doc) {
			slidesLength.value = doc.slides?.length || 0
			slides.value = JSON.parse(JSON.stringify(doc.slides || []))
			isPublicPresentation.value = Boolean(doc.is_public)
			markClean()
		},
	})
}

const getCompositePresentationResource = (name) => {
	return createResource({
		url: 'suite.slides.doctype.presentation.presentation.get_composite_presentation',
		method: 'GET',
		auto: false,
		makeParams: () => {
			return { name: name }
		},
		transform(doc) {
			for (const slide of doc.slides || []) {
				slide.elements = parseElements(slide.elements)
				slide.clientId = slide.client_id || uuid4()
				slide.transitionDuration = slide.transition_duration
				slide.fadeUnmatchedElements = slide.fade_unmatched_elements
				delete slide.thumbnail
				// remove the transition_duration field to avoid confusion
				delete slide.transition_duration
				delete slide.fade_unmatched_elements
				delete slide.client_id
			}
			ensureUniqueClientIds(doc.slides || [])
		},
		onSuccess(doc) {
			slidesLength.value = doc.slides?.length || 0
			slides.value = JSON.parse(JSON.stringify(doc.slides || []))
			isPublicPresentation.value = true
			markClean()
		},
	})
}

const savePresentationDoc = async (updatedSlides) => {
	const newSlides = updatedSlides.map((slide) => {
		const { thumbnail, ...slideData } = slide
		return {
			...slideData,
			client_id: slide.clientId,
			elements: JSON.stringify(slide.elements, null, 2),
			transition_duration: slide.transitionDuration,
			fade_unmatched_elements: slide.fadeUnmatchedElements,
		}
	})

	await presentationResource.value.setValue.submit({
		slides: newSlides,
	})

	presentationDoc.value = presentationResource.value.doc
}

const presentationResource = ref(null)

const initPresentationDoc = async (id, readonly = false) => {
	presentationId.value = id
	if (readonly) {
		presentationResource.value = getPublicPresentationResource(id)
		await presentationResource.value.fetch()
		if (presentationResource.value.data.is_composite) {
			presentationResource.value = getCompositePresentationResource(id)
			await presentationResource.value.fetch()
		}
		return presentationResource.value.data
	} else {
		presentationResource.value = getPresentationResource(id)
		await presentationResource.value.get.fetch()
		return presentationResource.value.doc
	}
}

const unsyncedPresentationRecord = ref({})

const isPublicPresentation = ref(false)

const templateList = ref([])

const templateListResource = createResource({
	url: 'suite.slides.doctype.presentation.presentation.get_templates',
	method: 'GET',
	cache: 'templates',
	onSuccess: (data) => {
		templateList.value = data
	},
})

const presentationTheme = computed(() => {
	return presentationDoc.value?.theme
})

const inReadonlyMode = ref(false)

const deletePresentation = async (presentation) => {
	await call('suite.slides.doctype.presentation.presentation.delete_presentation', {
		name: presentation,
	})
}

const duplicatePresentation = async (presentation) => {
	const newPresentation = await createPresentationResource.submit({
		duplicateFrom: presentation,
	})

	if (isDriveInstalled) {
		const parent = router.currentRoute.value.query.parent || ''
		call('suite.slides.api.file.create_drive_file', {
			title: newPresentation.title,
			name: newPresentation.name,
			parent: parent,
		})
	}

	return newPresentation.name
}

const resetEditorState = () => {
	presentationDoc.value = null
	slides.value = []
	slidesLength.value = 0
	isPublicPresentation.value = false
	commandHistory.clearHistory()
	markClean()
}

export {
	presentationId,
	applyReverseTransition,
	createPresentationResource,
	presentationDoc,
	transformElements,
	unsyncedPresentationRecord,
	isPublicPresentation,
	slidesLength,
	templateList,
	templateListResource,
	presentationTheme,
	inReadonlyMode,
	updatePresentationTitle,
	savePresentationDoc,
	initPresentationDoc,
	deletePresentation,
	duplicatePresentation,
	resetEditorState,
}
