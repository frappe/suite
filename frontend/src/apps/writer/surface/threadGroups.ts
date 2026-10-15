import type { DocumentThread } from '@/apps/drive'
import type { ThreadPlaces } from '@/apps/writer/collab/highlights'
import type { ThreadPlace } from '@/apps/writer/collab/places'

/** A titled run of threads in the comments panel; the title is empty when there are no places to group by. */
export interface ThreadGroup {
  title: string
  threads: { thread: DocumentThread; quote: string }[]
}

// In the panel's order, top to bottom (Q119 puts deleted text at the end)
const GROUP_TITLES = {
  document: 'Comments on the document',
  text: 'On the text',
  unplaced: 'Not attached to text',
  deleted: 'Original text deleted',
} as const

type GroupKey = keyof typeof GROUP_TITLES

// Read from Drive but not placed by the editor yet
const NOT_PLACED: ThreadPlace = { kind: 'arriving', quote: '' }

/** Groups the threads by where they show, the ones on text in reading order. */
export function groupThreads(threads: readonly DocumentThread[], places: ThreadPlaces | null) {
  const groups: ThreadGroup[] = []
  if (!places) {
    if (threads.length) {
      groups.push({ title: '', threads: threads.map((thread) => ({ thread, quote: '' })) })
    }

    return groups
  }

  const placed = threads.map((thread) => ({ thread, place: places.get(thread.name) ?? NOT_PLACED }))
  placed.sort((one, other) => readingOrder(one.place) - readingOrder(other.place))
  for (const key of Object.keys(GROUP_TITLES) as GroupKey[]) {
    const members = placed.filter(({ place }) => groupOf(place) === key)
    if (members.length) {
      const entries = members.map(({ thread, place }) => ({ thread, quote: quoteOf(place) }))
      groups.push({ title: GROUP_TITLES[key], threads: entries })
    }
  }

  return groups
}

// Threads whose text is still arriving show with the threads on text
function groupOf(place: ThreadPlace): GroupKey {
  if (place.kind === 'arriving') {
    return 'text'
  }

  return place.kind
}

// Threads on text first, by where their text starts; the rest keep Drive's order
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
