import { ref, computed } from 'vue'
import { createResource, call, frappeRequest, toast, dialog } from 'frappe-ui'

import tinycolor from 'tinycolor2'

import { router } from '@/apps/slides/router'
import { slides } from './slide'
import {
	markClean,
	markDirty,
	writeDraft,
	clearSaveFailure,
	saveRefused,
	getPresentationFromLocalDB,
} from './saving'
import { lockedElsewhere } from './editLock'
import { normalizeZIndices } from '@/apps/slides/stores/element'
import { normalizeColor } from '@/apps/slides/utils/color'
import { appDocumentTitle } from '@/utils/documentTitle'
import { getSessionUser } from '@/boot/session'
import { v4 as uuid4 } from 'uuid'
import { commandHistory } from './historyMeta'

const presentationDoc = ref()

const presentationId = ref(null)

// the user may not write this presentation at all
const viewOnly = ref(false)

// no write access, another tab of this browser holds the edit lock, or the server
// refused this tab's version; a reload is the only way on from the last one
const inReadonlyMode = computed(
	() => viewOnly.value || lockedElsewhere.value || saveRefused.value,
)

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
	const response = await call('suite.slides.doctype.presentation.presentation.update_title', {
		name: id,
		title: newTitle,
	})
	if (!response) throw new Error('Failed to rename presentation')
	await adoptServerVersion(id, response)
	// nothing refetches the doc after a rename, so the header would keep the old name
	if (presentationDoc.value?.name === id) {
		presentationDoc.value.title = newTitle
		presentationDoc.value.slug = response.slug
	}
	return response.slug
}

// adopting a stamp over a stale base would let the next save wipe rows saved elsewhere
const adoptServerVersion = (id, { modified, base_modified }) => {
	if (presentationDoc.value?.name !== id) return
	if (presentationDoc.value.modified === base_modified) presentationDoc.value.modified = modified
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

// only the latest load may commit; an older one lands on the presentation now open
let latestLoad = 0

const startLoad = () => ++latestLoad

const isLatestLoad = (load) => load === latestLoad

// an offline copy warms exactly this url and param order (utils/pinTargets.ts)
const fetchDoc = (name) =>
	frappeRequest({
		url: 'frappe.client.get',
		method: 'GET',
		params: { doctype: 'Presentation', name },
	})

// touches no editor state, so a save during the load still targets what is on screen
const fetchPresentation = async (name, load) => {
	const doc = await fetchDoc(name)
	const local = await getPresentationFromLocalDB(name).catch(() => null)
	// the push this draft waited on landed after all
	const landed = local?.dirty && holdsOwnRows(doc, local.content.map(toSlideRow))

	const clientIdsRepaired = normalizeSlideDoc(doc)
	for (const slide of doc.slides || []) {
		slide.elements = await transformElements(slide.elements)
	}

	// the worker may replay a document older than the last save; the copy that
	// save left behind is then the truth, and unsynced edits ride along in it
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
		// a clean copy is what the last successful save sent, so it is the
		// server content at baseModified and there is nothing to push
		return { doc, content: restored, dirty: local.dirty || repaired }
	}
	// the draft belongs to the tab that can write, on the presentation it is still opening;
	// this one neither rewrites nor reports it
	if (local?.dirty && isLatestLoad(load) && !viewOnly.value && !lockedElsewhere.value) {
		if (!landed) toast.warning('Changes that never reached the server were discarded.')
		// left dirty, the same draft is found and discarded again on every load
		await writeDraft({
			...local,
			dirty: false,
			updatedAt: Date.now(),
			baseModified: landed ? doc.modified : local.baseModified,
		})
	}

	// persist the repair
	return {
		doc,
		content: JSON.parse(JSON.stringify(doc.slides || [])),
		dirty: clientIdsRepaired,
	}
}

const showPresentation = (id, { doc, content, dirty }) => {
	presentationId.value = id
	presentationDoc.value = doc
	slides.value = content
	slidesLength.value = content.length
	// a tab that may not write has nothing of its own to push
	if (dirty && !inReadonlyMode.value) markDirty()
	else markClean()
}

const fetchReadonly = async (name, url) => {
	const doc = await frappeRequest({ url, method: 'GET', params: { name } })
	normalizeSlideDoc(doc)
	return doc
}

// rows are matched by client_id on the server, so name, parent and idx stay out
const toSlideRow = (slide) => ({
	client_id: slide.clientId,
	background: slide.background,
	elements: slide.corruptElements ?? JSON.stringify(slide.elements, null, 2),
	transition: slide.transition,
	transition_duration: slide.transitionDuration,
	fade_unmatched_elements: slide.fadeUnmatchedElements,
})

// what a push sends, as the server stores and returns it: Data comes back as strings, Check as 0/1
const rowKey = (row) =>
	JSON.stringify([
		row.client_id,
		row.background,
		row.elements,
		row.transition || null,
		String(row.transition_duration ?? ''),
		Number(row.fade_unmatched_elements ?? 0),
	])

const rowKeys = (rows) => rows.map(rowKey).join('\n')

// true when this user's push put exactly these rows on the server
const holdsOwnRows = (doc, rows) =>
	doc.modified_by === getSessionUser() && rowKeys(doc.slides || []) === rowKeys(rows)

// the push the client gave up on; the server may still take it in, and edits since build on it
let lastFailedPush = null

// the version a push left behind, or null if the server holds something else
const landedVersion = async (id, rows) => {
	const doc = await fetchDoc(id)
	if (holdsOwnRows(doc, rows)) return doc.modified
	if (lastFailedPush?.id !== id || !holdsOwnRows(doc, lastFailedPush.rows)) return null
	// what is here now goes out again on the version that push made
	if (presentationDoc.value?.name === id) presentationDoc.value.modified = doc.modified
	return null
}

// a push that never answers would otherwise hold the save gate for good
const SAVE_TIMEOUT_MS = 30_000

const pushSlides = async (id, rows, baseModified) => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)
	let response
	try {
		response = await frappeRequest({
			url: 'suite.slides.api.slides.save_slides',
			method: 'POST',
			params: {
				name: id,
				slides: rows,
				base_modified: baseModified,
			},
			signal: controller.signal,
		})
	} finally {
		clearTimeout(timer)
	}
	return response.modified
}

const savePresentationDoc = async (id, updatedSlides, baseModified) => {
	const rows = updatedSlides.map(toSlideRow)
	let modified
	try {
		modified = await pushSlides(id, rows, baseModified)
	} catch (err) {
		if (err?.exc_type !== 'TimestampMismatchError') {
			lastFailedPush = { id, rows }
			throw err
		}
		// a push the client gave up on may have landed anyway
		modified = await landedVersion(id, rows)
		if (!modified) throw err
	}
	lastFailedPush = null

	// the editor can move on mid-save; stamping then would mark another
	// presentation with this save's version
	if (presentationDoc.value?.name === id) presentationDoc.value.modified = modified

	return modified
}

// returns the committed doc, or null if a later load took over
const initPresentationDoc = async (id, readonly = false, load = startLoad()) => {
	let loaded

	if (readonly) {
		let doc = await fetchReadonly(
			id,
			'suite.slides.doctype.presentation.presentation.get_public_presentation',
		)
		if (doc.is_composite) {
			doc = await fetchReadonly(
				id,
				'suite.slides.doctype.presentation.presentation.get_composite_presentation',
			)
		}
		loaded = { doc, content: JSON.parse(JSON.stringify(doc.slides || [])), dirty: false }
	} else {
		loaded = await fetchPresentation(id, load)
	}

	if (!isLatestLoad(load)) return null

	// a refused tab reloading in place writes again once the server copy is on screen
	clearSaveFailure()
	showPresentation(id, loaded)
	frappeRequest({
		url: 'suite.drive.api.files.track_visit',
		params: { doctype: 'Presentation', docname: id },
	}).catch(() => {})
	return loaded.doc
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
	const title = presentationDoc.value?.title
	return appDocumentTitle(title, 'Slides')
}

const resetEditorState = () => {
	// a load in flight would commit over the blank editor
	startLoad()
	presentationDoc.value = null
	slides.value = []
	slidesLength.value = 0
	commandHistory.clearHistory()
	markClean()
	clearSaveFailure()
	// a push landing now would otherwise read the blank slides back as this presentation's edit
	presentationId.value = null
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
	viewOnly,
	inReadonlyMode,
	updatePresentationTitle,
	adoptServerVersion,
	savePresentationDoc,
	initPresentationDoc,
	startLoad,
	isLatestLoad,
	confirmDeletePresentation,
	duplicatePresentation,
	resetEditorState,
	pageTitle,
}
