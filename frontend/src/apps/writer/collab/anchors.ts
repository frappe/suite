import * as yjs from 'yjs'

/** Drive's anchor column, counted in code points as Drive and MariaDB count it. */
export const ANCHOR_LIMIT = 255
const QUOTE_LIMIT = 150
/** A thread on the whole document rather than on its text. */
export const DOCUMENT_ANCHOR = 'document'

/**
 * Where a thread sits: the whole document, a text range with its quote, text deleted before the
 * thread had a place, or nowhere this client can find.
 */
export type ThreadAnchor =
  | { kind: 'document' }
  | { kind: 'text'; start: yjs.RelativePosition; end: yjs.RelativePosition; quote: string }
  | { kind: 'deleted'; quote: string }
  | { kind: 'unplaced' }

interface StoredAnchor {
  v: 1
  s: string
  e: string
  q: string
}

/** The anchor Drive stores for a range: both ends, and as much of the quote as fits. */
export function encodeAnchor(
  start: yjs.RelativePosition,
  end: yjs.RelativePosition,
  quote: string,
): string {
  const stored: StoredAnchor = {
    v: 1,
    s: toBase64(yjs.encodeRelativePosition(start)),
    e: toBase64(yjs.encodeRelativePosition(end)),
    q: '',
  }
  const characters = [...quote].slice(0, QUOTE_LIMIT)
  let anchor = JSON.stringify({ ...stored, q: characters.join('') })
  while ([...anchor].length > ANCHOR_LIMIT && characters.length) {
    characters.pop()
    anchor = JSON.stringify({ ...stored, q: characters.join('') })
  }

  return anchor
}

/** Reads a stored anchor; an old comment id or anything unreadable is unplaced, never an error. */
export function readAnchor(anchor: string): ThreadAnchor {
  if (anchor === DOCUMENT_ANCHOR) {
    return { kind: 'document' }
  }

  let value: unknown
  try {
    value = JSON.parse(anchor)
  } catch {
    // An old comment id from before collaboration
    return { kind: 'unplaced' }
  }

  return readStoredAnchor(value as Partial<StoredAnchor> | null)
}

function readStoredAnchor(stored: Partial<StoredAnchor> | null): ThreadAnchor {
  if (stored?.v !== 1 || typeof stored.q !== 'string') {
    return { kind: 'unplaced' }
  }

  if (stored.s === undefined && stored.e === undefined) {
    return { kind: 'deleted', quote: stored.q }
  }

  if (typeof stored.s !== 'string' || typeof stored.e !== 'string') {
    return { kind: 'unplaced' }
  }

  try {
    const start = yjs.decodeRelativePosition(fromBase64(stored.s))
    const end = yjs.decodeRelativePosition(fromBase64(stored.e))
    return { kind: 'text', start, end, quote: stored.q }
  } catch {
    return { kind: 'unplaced' }
  }
}

/** The text a text anchor was made on; empty for any other anchor. */
export function anchorQuote(anchor: string) {
  const read = readAnchor(anchor)
  if (read.kind !== 'text') {
    return ''
  }

  return read.quote
}

/** The Yjs items a text anchor's ends hold on to; none for any other anchor. */
export function anchorEnds(anchor: string): yjs.ID[] {
  const read = readAnchor(anchor)
  if (read.kind !== 'text') {
    return []
  }

  const ends: yjs.ID[] = []
  for (const position of [read.start, read.end]) {
    const id = heldId(position)
    if (id) {
      ends.push(id)
    }
  }

  return ends
}

/** A stored position keeps only the character it holds, or its block when it holds none. */
export function heldId(position: yjs.RelativePosition) {
  return position.item ?? position.type
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
