import type { DocumentThread } from '@/apps/drive'
import type { ThreadPlaces } from '@/apps/writer/collab/highlights'
import type { ThreadPlace } from '@/apps/writer/collab/places'

/** A thread as the comments panel lists it, with a word when its text was deleted. */
export interface ThreadRow {
  thread: DocumentThread
  quote: string
  where: string
}

// In the panel's order, top to bottom (Q119 puts deleted text at the end)
const PLACE_WORDS = {
  document: '',
  text: '',
  unplaced: '',
  deleted: 'Text deleted',
} as const

type PlaceKey = keyof typeof PLACE_WORDS

const PLACE_ORDER = Object.keys(PLACE_WORDS) as PlaceKey[]

// Read from Drive but not placed by the editor yet
const NOT_PLACED: ThreadPlace = { kind: 'arriving', quote: '' }

/** The threads in the panel's order, the ones on text in reading order; unordered when the editor places none. */
export function threadRows(threads: readonly DocumentThread[], places: ThreadPlaces | null) {
  if (!places) {
    return threads.map((thread): ThreadRow => ({ thread, quote: '', where: '' }))
  }

  const placed = threads.map((thread) => ({ thread, place: places.get(thread.name) ?? NOT_PLACED }))
  placed.sort((one, other) => comparePlaces(one.place, other.place))
  return placed.map(({ thread, place }): ThreadRow => ({
    thread,
    quote: quoteOf(place),
    where: PLACE_WORDS[placeKey(place)],
  }))
}

// Threads whose text is still arriving show with the threads on text
function placeKey(place: ThreadPlace): PlaceKey {
  if (place.kind === 'arriving') {
    return 'text'
  }

  return place.kind
}

function comparePlaces(one: ThreadPlace, other: ThreadPlace) {
  const byKind = PLACE_ORDER.indexOf(placeKey(one)) - PLACE_ORDER.indexOf(placeKey(other))
  return byKind || readingOrder(one) - readingOrder(other)
}

// Threads on text by where their text starts; the rest keep Drive's order
function readingOrder(place: ThreadPlace) {
  if (place.kind === 'text') {
    return place.from
  }

  return Number.MAX_SAFE_INTEGER
}

function quoteOf(place: ThreadPlace) {
  if ('quote' in place) {
    return place.quote
  }

  return ''
}
