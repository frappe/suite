import { ref, computed } from 'vue'
import { createResource, call, createDocumentResource, frappeRequest, toast, dialog } from 'frappe-ui'

import tinycolor from 'tinycolor2'

import { router } from '@/apps/slides/router'
import { slides } from './slide'
import { markClean, markDirty, getPresentationFromLocalDB } from './saving'
import { normalizeZIndices } from '@/apps/slides/stores/element'
import { normalizeColor } from '@/apps/slides/utils/color'
import { v4 as uuid4 } from 'uuid'
import { commandHistory } from './historyMeta'

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
			parent: args.parent,
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
		if (!response) throw new Error('Failed to rename presentation')
		// autosave stamps this onto the local copy, so a stale value would make the
		// next load discard edits that had not synced yet
		if (presentationDoc.value?.name === id) presentationDoc.value.modified = response.modified
		return response.slug
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

const migrateShadow = (el) => {
	// legacy px shadow (shadowSpread/shadowOffsetX/shadowOffsetY) -> size-relative model
	if (el.shadowOffset != null) return
	const hasLegacyShadow =
		el.shadowSpread != null || el.shadowOffsetX != null || el.shadowOffsetY != null
	if (!hasLegacyShadow) return

	const refSize = Number(el.width) || 1
	const offsetX = Number(el.shadowOffsetX || 0)
	const offsetY = Number(el.shadowOffsetY || 0)
	const toRelativeSize = (px) => Math.round((px / refSize) * 1000) / 10
	const offsetAngle = ((Math.atan2(offsetY, offsetX) * 180) / Math.PI + 360) % 360

	el.shadowBlur = toRelativeSize(Number(el.shadowSpread || 0))
	el.shadowOffset = toRelativeSize(Math.hypot(offsetX, offsetY))
	el.shadowAngle = offsetX || offsetY ? Math.round(offsetAngle) : 45
	el.shadowOpacity = Math.round(tinycolor(el.shadowColor || '#000000ff').getAlpha() * 100)

	delete el.shadowSpread
	delete el.shadowOffsetX
	delete el.shadowOffsetY
}

const parseElements = (value, slide) => {
	if (!value) return []

	let parsed = []
	if (Array.isArray(value)) {
		parsed = value
	} else if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value)
		} catch (err) {
			console.error('Failed to parse slide elements', err)
			toast.error(
				'A slide could not be read. Its content is preserved but hidden; avoid saving over it.',
			)
			if (slide) slide.corruptElements = value
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
		for (const key of ['fillColor', 'strokeColor', 'borderColor', 'shadowColor']) {
			if (el[key]) el[key] = normalizeColor(el[key])
		}
		migrateShadow(el)
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

const normalizeSlideDoc = (doc) => {
	for (const slide of doc.slides || []) {
		slide.background = normalizeColor(slide.background)
		slide.elements = parseElements(slide.elements, slide)
		slide.clientId = slide.client_id || uuid4()
		slide.transitionDuration = slide.transition_duration
		slide.fadeUnmatchedElements = slide.fade_unmatched_elements
		delete slide.thumbnail
		// remove the transition_duration field to avoid confusion
		delete slide.transition_duration
		delete slide.fade_unmatched_elements
		delete slide.client_id
	}
	return ensureUniqueClientIds(doc.slides || [])
}

const slidesLength = ref(0)

const getPresentationResource = (name) => {
	let clientIdsRepaired = false
	return createDocumentResource({
		doctype: 'Presentation',
		name: name,
		auto: false,
		transform(doc) {
			clientIdsRepaired = normalizeSlideDoc(doc)
		},
		async onSuccess(doc) {
			slidesLength.value = doc.slides?.length || 0
			for (const slide of doc.slides || []) {
				slide.elements = await transformElements(slide.elements)
			}

			// the worker may replay a document older than the last save; the copy that
			// save left behind is then the truth, and unsynced edits ride along in it
			const local = await getPresentationFromLocalDB(name)
			const servedIsStale = local?.baseModified > doc.modified
			if (servedIsStale || (local?.dirty && local.baseModified === doc.modified)) {
				if (servedIsStale) doc.modified = local.baseModified
				const restored = JSON.parse(JSON.stringify(local.content))
				// local content skips the load pipeline; migrate + dedup it here too
				for (const slide of restored) {
					slide.background = normalizeColor(slide.background)
					slide.elements = parseElements(slide.elements, slide)
				}
				const repaired = ensureUniqueClientIds(restored)
				slides.value = restored
				slidesLength.value = slides.value.length
				// a clean copy is what the last successful save sent, so it is the
				// server content at baseModified and there is nothing to push
				if (local.dirty || repaired) markDirty()
				else markClean()
				return
			}
			if (local?.dirty) toast.warning('Changes that never reached the server were discarded.')

			slides.value = JSON.parse(JSON.stringify(doc.slides || []))
			markClean()
			// persist the repair
			if (clientIdsRepaired) markDirty()
		},
	})
}

const getReadonlyPresentationResource = (name, url) => {
	return createResource({
		url,
		method: 'GET',
		auto: false,
		makeParams: () => {
			return { name: name }
		},
		transform(doc) {
			normalizeSlideDoc(doc)
		},
		onSuccess(doc) {
			slidesLength.value = doc.slides?.length || 0
			slides.value = JSON.parse(JSON.stringify(doc.slides || []))
			markClean()
		},
	})
}

const savePresentationDoc = async (updatedSlides) => {
	const newSlides = updatedSlides.map((slide) => {
		const { thumbnail, corruptElements, ...slideData } = slide
		return {
			...slideData,
			client_id: slide.clientId,
			elements: corruptElements ?? JSON.stringify(slide.elements, null, 2),
			transition_duration: slide.transitionDuration,
			fade_unmatched_elements: slide.fadeUnmatchedElements,
		}
	})

	const resource = presentationResource.value
	const doc = await resource.setValue.submit({
		slides: newSlides,
	})

	// the editor can move on mid-save, and repointing presentationDoc at whatever
	// the resource ref holds now would stamp this save onto another presentation
	if (presentationResource.value === resource) presentationDoc.value = resource.doc

	return doc?.modified
}

const presentationResource = ref(null)

const initPresentationDoc = async (id, readonly = false) => {
	presentationId.value = id
	let doc
	if (readonly) {
		presentationResource.value = getReadonlyPresentationResource(
			id,
			'suite.slides.doctype.presentation.presentation.get_public_presentation',
		)
		await presentationResource.value.fetch()
		if (presentationResource.value.data.is_composite) {
			presentationResource.value = getReadonlyPresentationResource(
				id,
				'suite.slides.doctype.presentation.presentation.get_composite_presentation',
			)
			await presentationResource.value.fetch()
		}
		doc = presentationResource.value.data
	} else {
		presentationResource.value = getPresentationResource(id)
		await presentationResource.value.get.fetch()
		doc = presentationResource.value.doc
	}
	frappeRequest({
		url: 'suite.drive.api.files.track_visit',
		params: { doctype: 'Presentation', docname: id },
	}).catch(() => {})
	return doc
}

const templateList = ref([])

const templateListResource = createResource({
	url: 'suite.slides.doctype.presentation.presentation.get_templates',
	method: 'GET',
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

const confirmDeletePresentation = ({ name, title }, onDeleted) =>
	dialog.confirm({
		title: 'Delete presentation',
		message: `"${title}" will be permanently deleted.`,
		actions: [
			{ label: 'Cancel', variant: 'outline' },
			{
				label: 'Delete',
				variant: 'solid',
				theme: 'red',
				onClick: async () => {
					await deletePresentation(name)
					await onDeleted()
				},
			},
		],
	})

const duplicatePresentation = async (presentation) => {
	const newPresentation = await createPresentationResource.submit({
		duplicateFrom: presentation,
		parent: router.currentRoute.value.query.parent || '',
	})

	return newPresentation.name
}

const pageTitle = () => {
	const appTitle = router.currentRoute.value.meta.title || 'Frappe Slides'
	const title = presentationDoc.value?.title
	return title ? `${title} - ${appTitle}` : appTitle
}

const resetEditorState = () => {
	presentationDoc.value = null
	slides.value = []
	slidesLength.value = 0
	commandHistory.clearHistory()
	markClean()
}

export {
	presentationId,
	applyReverseTransition,
	createPresentationResource,
	presentationDoc,
	transformElements,
	slidesLength,
	templateList,
	templateListResource,
	presentationTheme,
	inReadonlyMode,
	updatePresentationTitle,
	savePresentationDoc,
	initPresentationDoc,
	deletePresentation,
	confirmDeletePresentation,
	duplicatePresentation,
	resetEditorState,
	pageTitle,
}
