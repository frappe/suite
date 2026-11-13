import { toast } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, client } from '@/api'
import { normalizeZIndices } from '@/apps/slides/stores/element'
import { normalizeColor } from '@/apps/slides/utils/color'
import { migrateShadow } from '@/apps/slides/utils/oldShadow'
import { appDocumentTitle } from '@/platform/page-meta'
import { randomId } from '@/platform/random-id'

import { recordVisit } from './driveVisit'
import { commandHistory } from './historyMeta'
import { slides } from './slide'

const presentationDoc = ref()

/** @type {import('vue').Ref<string | null>} */
const presentationId = ref(null)

// the user may not write this presentation at all
const viewOnly = ref(false)

const inReadonlyMode = computed(() => viewOnly.value)

const applyReverseTransition = ref(false)

// The open surface binds its owner-selected access context to this deck.
const documentContexts = new Map()
function setDocumentContext(id, context) {
  const binding = { context }
  documentContexts.set(id, binding)
  return () => {
    if (documentContexts.get(id) === binding) documentContexts.delete(id)
  }
}
const contextFor = (id) => documentContexts.get(id)?.context

const HALF = 0.5

// appended before the fonts are awaited: laying it out is what starts their download
function placeForMeasuring(el) {
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
  return tempDiv
}

function readMeasured(tempDiv, el) {
  const width = el.width || tempDiv.offsetWidth
  const height = tempDiv.offsetHeight
  document.body.removeChild(tempDiv)
  return { width, height }
}

async function getElementDimensions(el) {
  const tempDiv = placeForMeasuring(el)
  await document.fonts.ready
  return readMeasured(tempDiv, el)
}

function measureNow(el) {
  return readMeasured(placeForMeasuring(el), el)
}

function isCentred(el) {
  return el.transform === 'translate(-50%, -50%)'
}

function toTopLeft(el, { width, height }) {
  return {
    ...el,
    transform: 'none',
    transformOrigin: 'top left',
    left: el.left - width * HALF,
    top: el.top - height * HALF,
  }
}

function withoutTransform(el) {
  return { ...el, transform: 'none', transformOrigin: 'top left' }
}

const transformElements = async (elements) => {
  const newEls = []

  for (const el of elements) {
    if (el.type !== 'text') {
      newEls.push(el)
    } else if (isCentred(el)) {
      newEls.push(toTopLeft(el, await getElementDimensions(el)))
    } else if (!('transform' in el)) {
      newEls.push(withoutTransform(el))
    } else {
      newEls.push(el)
    }
  }

  return newEls
}

// the same, for a live change that must be drawn at once. The fonts of text there when
// the room opened were loaded through `transformElements`, later ones may still be loading
function flattenNow(el, measure = measureNow) {
  if (el.type !== 'text') {
    return el
  }

  if (isCentred(el)) {
    return toTopLeft(el, measure(el))
  }

  if ('transform' in el) {
    return el
  }

  return withoutTransform(el)
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

// Rescue decks saved with duplicate client_ids.
const ensureUniqueClientIds = (slides) => {
  const seen = new Set()
  for (const slide of slides) {
    if (seen.has(slide.clientId)) {
      slide.clientId = randomId()
    }
    seen.add(slide.clientId)
  }
}

const normalizeSlideDoc = (doc) => {
  for (const slide of doc.slides || []) {
    slide.background = normalizeColor(slide.background)
    slide.elements = parseElements(slide.elements, slide)
    slide.clientId = slide.client_id || randomId()
    slide.transitionDuration = slide.transition_duration
    slide.fadeUnmatchedElements = slide.fade_unmatched_elements
    slide.advanceAfter = slide.advance_after
    delete slide.thumbnail
    // remove the transition_duration field to avoid confusion
    delete slide.transition_duration
    delete slide.fade_unmatched_elements
    delete slide.advance_after
    delete slide.client_id
  }

  ensureUniqueClientIds(doc.slides || [])
}

/** Stored slide rows as the store draws them, as a presentation on its rows opens. Leaves `rows` alone. */
export function rowSlides(rows) {
  const doc = { slides: JSON.parse(JSON.stringify(rows)) }
  normalizeSlideDoc(doc)
  return doc.slides
}

const slidesLength = ref(0)

// only the latest load may commit; an older one lands on the presentation now open
let latestLoad = 0

const startLoad = () => ++latestLoad

const isLatestLoad = (load) => load === latestLoad

// bumped each time a presentation opens, so reopening one is a new opening
let opening = 0

// work that waited may land only in the opening it started in
function currentOpening() {
  const id = presentationId.value
  const at = opening
  return () => id != null && presentationId.value === id && opening === at
}

// an offline copy warms exactly this url and param order (utils/pinTargets.ts).
// Guest-reachable, so a share link's holder loads the deck to edit it too.
const fetchDoc = (name) =>
  client.query(api.slides.documents.get, { name }, { context: contextFor(name) })

const fetchPresentation = async (name) => {
  const doc = structuredClone(await fetchDoc(name))
  normalizeSlideDoc(doc)
  for (const slide of doc.slides || []) {
    slide.elements = await transformElements(slide.elements)
  }

  return { doc, content: JSON.parse(JSON.stringify(doc.slides || [])) }
}

const showPresentation = (id, { doc, content }) => {
  // a reload in place stays in the same opening
  if (presentationId.value !== id) {
    opening++
  }
  presentationId.value = id
  presentationDoc.value = doc
  slides.value = content
  slidesLength.value = content.length
}

const fetchReadonly = async (name, reference) => {
  const doc = structuredClone(
    await client.query(reference, { name }, { context: contextFor(name) }),
  )
  normalizeSlideDoc(doc)
  return doc
}

// returns the committed doc, or null if a later load took over
/** @returns {Promise<Record<string, unknown> | null>} */
const initPresentationDoc = async (id, readonly = false, load = startLoad()) => {
  let loaded

  if (readonly) {
    let doc = await fetchReadonly(id, api.slides.documents.get)
    if (doc.is_composite) {
      doc = await fetchReadonly(id, api.slides.documents.composite)
    }

    loaded = { doc, content: JSON.parse(JSON.stringify(doc.slides || [])) }
  } else {
    loaded = await fetchPresentation(id)
  }

  if (!isLatestLoad(load)) return null

  showPresentation(id, loaded)
  // on `/d/` the Drive document session records the visit when it opens
  if (!documentContexts.has(id) && loaded.doc.node) recordVisit(loaded.doc.node).catch(() => {})
  return loaded.doc
}

/** @type {import('vue').Ref<import('@/apps/slides/client/generated').GetTemplatesOutput>} */
const templateList = ref([])

const loadTemplates = async () => {
  if (templateList.value.length || inReadonlyMode.value) return
  try {
    templateList.value = await client.query(api.slides.templates.list, {}, { cache: 'prefer' })
  } catch (error) {
    if (navigator.onLine) {
      toast.error(error.message || 'Could not load templates')
    }
  }
}

// a presentation with no theme, or one the caller can't read, adds slides from Light
const presentationTheme = computed(() => {
  const theme = presentationDoc.value?.theme
  if (templateList.value.some((template) => template.name === theme)) {
    return theme
  }

  return templateList.value.find((template) => template.title === 'Light')?.name
})

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
  presentationId.value = null
}

export {
  presentationId,
  applyReverseTransition,
  presentationDoc,
  transformElements,
  slidesLength,
  templateList,
  loadTemplates,
  presentationTheme,
  flattenNow,
  measureNow,
  viewOnly,
  inReadonlyMode,
  initPresentationDoc,
  currentOpening,
  resetEditorState,
  pageTitle,
  setDocumentContext,
  contextFor,
}
