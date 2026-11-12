import { toast } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, client } from '@/api'
import { normalizeZIndices } from '@/apps/slides/stores/element'
import { normalizeColor } from '@/apps/slides/utils/color'
import { serverAnswers } from '@/apps/slides/utils/offlineRequests'
import { migrateShadow } from '@/apps/slides/utils/oldShadow'
import { appDocumentTitle } from '@/platform/page-meta'
import { randomId } from '@/platform/random-id'
import { getCookieSessionUser } from '@/platform/session'
import { translate } from '@/platform/translation'

import { draftOutcome, needsServerCheck } from './draftOutcome'
import { recordVisit } from './driveVisit'
import { commandHistory } from './historyMeta'
import {
  clearSaveFailure,
  getPresentationFromLocalDB,
  markClean,
  markDirty,
  saveRefused,
  writeDraft,
} from './saving'
import { slides } from './slide'

const presentationDoc = ref()

/** @type {import('vue').Ref<string | null>} */
const presentationId = ref(null)

// the user may not write this presentation at all
const viewOnly = ref(false)

// the server refused this tab's version, which only a reload clears
const writesBlocked = computed(() => saveRefused.value)
// That, or the user has no write access.
const inReadonlyMode = computed(() => viewOnly.value || writesBlocked.value)

const applyReverseTransition = ref(false)

// The open surface binds its owner-selected access context to this deck.
const documentContexts = new Map()
function setDocumentContext(id, context, onRefused, keepDiscarded) {
  const binding = { context, onRefused, keepDiscarded }
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

// Rescue decks saved with duplicate client_ids. Returns true if anything changed.
const ensureUniqueClientIds = (slides) => {
  const seen = new Set()
  let repaired = false
  for (const slide of slides) {
    if (seen.has(slide.clientId)) {
      slide.clientId = randomId()
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
  return ensureUniqueClientIds(doc.slides || [])
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

// false leaves the draft in place: with no copy, it is the only place the edits live
function copyDiscarded(name, content) {
  const keepDiscarded = documentContexts.get(name)?.keepDiscarded
  if (!keepDiscarded) {
    return false
  }

  try {
    keepDiscarded(content)
    return true
  } catch {
    return false
  }
}

// local content skips the load pipeline; migrate it here too
function parsedLocalSlides(content) {
  const parsed = JSON.parse(JSON.stringify(content))
  for (const slide of parsed) {
    slide.background = normalizeColor(slide.background)
    slide.elements = parseElements(slide.elements, slide)
  }

  return parsed
}

// touches no editor state, so a save during the load still targets what is on screen
const fetchPresentation = async (name, load) => {
  const doc = structuredClone(await fetchDoc(name))
  const local = await getPresentationFromLocalDB(name).catch(() => null)
  // the push this draft waited on landed after all
  const landed = local?.dirty && holdsOwnRows(doc, local.content.map(toSlideRow))

  const clientIdsRepaired = normalizeSlideDoc(doc)
  for (const slide of doc.slides || []) {
    slide.elements = await transformElements(slide.elements)
  }

  // the rows of a deck the layer holds or is about to take are only there to read,
  // so a draft stays on the device, unrestored
  if (doc.is_converted || doc.conversion) {
    return { doc, content: JSON.parse(JSON.stringify(doc.slides || [])), dirty: false }
  }

  const hasServerAnswered = needsServerCheck(local, doc.modified, landed) && (await serverAnswers())
  const outcome = draftOutcome(local, doc.modified, landed, hasServerAnswered)
  const keepBase = outcome === 'keep'
  const isOnServedBase = outcome === 'restore'
  // the draft belongs to the tab that can write, on the presentation it is still opening;
  // this one neither rewrites nor reports it
  const isOwnDraft = local?.dirty && isLatestLoad(load) && !viewOnly.value
  const isUncopied =
    outcome === 'discard' && isOwnDraft && !landed && !copyDiscarded(name, local.content)

  if (keepBase || isOnServedBase || isUncopied) {
    if (keepBase || isUncopied) {
      // a draft with no base gets the empty one: the server refuses it, so the hold takes over
      doc.modified = local.baseModified ?? ''
    }

    const restored = parsedLocalSlides(local.content)
    const repaired = ensureUniqueClientIds(restored)
    // a clean row here is what the last successful save sent, since a retired one
    // is discarded: it is the server content at baseModified, with nothing to push
    return { doc, content: restored, dirty: local.dirty || repaired }
  }

  if (isOwnDraft) {
    if (!landed) {
      toast.warning(
        translate('Your changes never reached the server. They are kept on this device.'),
      )
    }

    // left dirty, the same draft is found and discarded again on every load; so is an
    // older tick's retry landing over this write, unless it is built on the served base
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
  // a refused tab reloading in place stays in the same opening
  if (presentationId.value !== id) {
    opening++
  }
  presentationId.value = id
  presentationDoc.value = doc
  slides.value = content
  slidesLength.value = content.length
  // a tab that may not write has nothing of its own to push
  if (dirty && !inReadonlyMode.value) markDirty()
  else markClean()
}

const fetchReadonly = async (name, reference) => {
  const doc = structuredClone(
    await client.query(reference, { name }, { context: contextFor(name) }),
  )
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
  advance_after: slide.advanceAfter,
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
    String(row.advance_after ?? ''),
  ])

const rowKeys = (rows) => rows.map(rowKey).join('\n')

// true when this user's push put exactly these rows on the server
const holdsOwnRows = (doc, rows) =>
  doc.modified_by === getCookieSessionUser() && rowKeys(doc.slides || []) === rowKeys(rows)

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

// `cancel` aborts the push too: saving.js cancels it when edit access goes
const pushSlides = async (id, rows, baseModified, cancel) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS)
  const abort = () => controller.abort()
  if (cancel?.aborted) abort()
  cancel?.addEventListener('abort', abort, { once: true })
  let response
  try {
    response = await client.mutation(
      api.slides.documents.save,
      {
        name: id,
        slides: rows,
        base_modified: baseModified,
      },
      { context: contextFor(id), signal: controller.signal, silent: true },
    )
  } finally {
    clearTimeout(timer)
    cancel?.removeEventListener('abort', abort)
  }
  return response.modified
}

// as a load would read `content` and a push send it: a server row has its own name and types
function showsSlides(content) {
  return (
    rowKeys(parsedLocalSlides(content).map(toSlideRow)) === rowKeys(slides.value.map(toSlideRow))
  )
}

const savePresentationDoc = async (id, updatedSlides, baseModified, cancel) => {
  const rows = updatedSlides.map(toSlideRow)
  let modified
  try {
    modified = await pushSlides(id, rows, baseModified, cancel)
  } catch (err) {
    if (err?.type !== 'TimestampMismatchError') {
      if (err?.status === 401 || err?.status === 403) documentContexts.get(id)?.onRefused?.()
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
/** @returns {Promise<Record<string, unknown> | null>} */
const initPresentationDoc = async (id, readonly = false, load = startLoad()) => {
  let loaded

  if (readonly) {
    let doc = await fetchReadonly(id, api.slides.documents.get)
    if (doc.is_composite) {
      doc = await fetchReadonly(id, api.slides.documents.composite)
    }
    loaded = { doc, content: JSON.parse(JSON.stringify(doc.slides || [])), dirty: false }
  } else {
    loaded = await fetchPresentation(id, load)
  }

  if (!isLatestLoad(load)) return null

  // a refused tab reloading in place writes again once the server copy is on screen
  clearSaveFailure()
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
  markClean()
  clearSaveFailure()
  // a push landing now would otherwise read the blank slides back as this presentation's edit
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
  writesBlocked,
  savePresentationDoc,
  initPresentationDoc,
  currentOpening,
  showsSlides,
  startLoad,
  resetEditorState,
  pageTitle,
  setDocumentContext,
  contextFor,
}
