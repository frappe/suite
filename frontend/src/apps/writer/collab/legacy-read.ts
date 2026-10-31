import { getSchema } from '@tiptap/core'
import { applyUpdate, Doc, XmlElement, XmlFragment, XmlText, type AbstractType } from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { writerSchema } from '@/apps/writer/schema'

const schema = getSchema(writerSchema())

/** An old Writer document as its row stores it. */
export interface LegacyBody {
  content: string | null
  html: string | null
  collab: number
  ycomments: string | null
}

export function isContent(type: AbstractType<unknown>) {
  if (type instanceof XmlText) {
    return type.length > 0
  }

  return (
    type instanceof XmlElement &&
    (isAtomName(type.nodeName) ||
      Object.values(type.getAttributes()).some((value) => value != null))
  )
}

// Drive's table of contents, drawn from the headings, stores only the hint it showed
const OLD_TOC = 'tocNode'

export function isHintOnlyToc(part: AbstractType<unknown>) {
  return (
    part instanceof XmlElement &&
    part.nodeName === OLD_TOC &&
    Object.entries(part.getAttributes()).every(
      ([key, value]) => key === 'placeholder' || value == null,
    ) &&
    !!part.createTreeWalker(isContent).next().done
  )
}

// Blocks that hold no words when empty, and the line break, which never does
const WORDLESS = new Set(['paragraph', 'heading', 'hardBreak'])

function isWordOrPart(type: AbstractType<unknown>) {
  if (type instanceof XmlText) {
    return type.length > 0
  }

  if (isHintOnlyToc(type)) {
    return false
  }

  // An atom or media holds its data whatever stray children it has
  return (
    type instanceof XmlElement &&
    (isAtomName(type.nodeName) ||
      MEDIA.has(type.nodeName) ||
      (!type.length && !WORDLESS.has(type.nodeName)))
  )
}

// No words, embeds or parts; what empty blocks store, like a heading's level, isn't counted
function holdsNothing(body: XmlFragment) {
  return !!body.createTreeWalker(isWordOrPart).next().done
}

// A line break the HTML parser had nowhere to put loses no words, so breaks aren't counted
export function isAtomName(name: string) {
  const type = schema.nodes[name]
  return !!type && type.isLeaf && !type.isText && name !== 'hardBreak'
}

function decoded(content: string) {
  const old = new Doc()
  try {
    applyUpdate(
      old,
      Uint8Array.from(atob(content), (char) => char.charCodeAt(0)),
    )
  } catch {
    return null
  }

  return old
}

export const MEDIA = new Set(['resizableMedia', 'image', 'video'])

/** What an old document's Yjs store holds: a body, a body holding nothing, no bytes, or bytes Yjs can't read. */
export type LegacyRead =
  | { case: 'yjs'; old: Doc }
  | { case: 'empty-yjs'; old: Doc; html: string }
  | { case: 'no-yjs'; html: string }
  | { case: 'unreadable-yjs'; html: string }

/** Which of an old document's stores holds its body. */
export function readLegacy(legacy: LegacyBody): LegacyRead {
  const html = legacy.html ?? ''
  // A body saved without collaboration, or with no Yjs bytes stored, has only its HTML
  if (legacy.collab === 0 || !legacy.content) {
    return { case: 'no-yjs', html }
  }

  const old = decoded(legacy.content)
  if (!old) {
    return { case: 'unreadable-yjs', html }
  }

  if (holdsNothing(old.getXmlFragment(BODY_FIELD))) {
    return { case: 'empty-yjs', old, html }
  }

  return { case: 'yjs', old }
}
