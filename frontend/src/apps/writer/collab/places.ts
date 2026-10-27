import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from '@tiptap/y-tiptap'
import * as yjs from 'yjs'

import { encodeAnchor, heldId, readAnchor } from './anchors'

/** Where a thread shows in this tab. */
export type ThreadPlace =
  | { kind: 'document' }
  | { kind: 'text'; from: number; to: number; quote: string }
  // An end's text hasn't reached this tab yet
  | { kind: 'arriving'; quote: string }
  // Every character it was made on is deleted
  | { kind: 'deleted'; quote: string }
  // An old comment moved over without its place
  | { kind: 'unplaced' }

/** Finds a thread's text in the editor: the part of it still there, never anything outside it. */
export function placeThread(state: EditorState, anchor: string): ThreadPlace {
  const read = readAnchor(anchor)
  if (read.kind !== 'text') {
    return read
  }

  const sync = ySyncPluginKey.getState(state)
  const hasArrived = sync?.binding && isInDoc(sync.doc, read.start) && isInDoc(sync.doc, read.end)
  if (!hasArrived) {
    return { kind: 'arriving', quote: read.quote }
  }

  const { doc, type, binding } = sync
  const { mapping, hidden } = binding
  const [from, to] = [read.start, read.end].map((end) => {
    if (isInDeletedBlock(doc, end)) {
      return null
    }

    return relativePositionToAbsolutePosition(doc, type, end, mapping, hidden)
  })
  if (from === null || to === null) {
    return { kind: 'deleted', quote: read.quote }
  }

  // The binding holds the text before the editor first draws it
  const size = state.doc.content.size
  if (from > size || to > size) {
    return { kind: 'arriving', quote: read.quote }
  }

  if (from >= to || !holdsLeaf(state.doc, from, to)) {
    return { kind: 'deleted', quote: read.quote }
  }

  return { kind: 'text', from, to, quote: read.quote }
}

/** The anchor for the selected text: from its first character to its last, with its words as the quote. */
export function anchorSelection(state: EditorState): string | null {
  const { from, to } = state.selection
  const sync = ySyncPluginKey.getState(state)
  if (from === to || !sync?.binding) {
    return null
  }

  const { doc, type, binding } = sync
  const { mapping, hidden } = binding
  const start = positionAt(doc, absolutePositionToRelativePosition(from, type, mapping, hidden), 0)
  const end = positionAt(doc, absolutePositionToRelativePosition(to, type, mapping, hidden), -1)
  return encodeAnchor(start, end, quoteBetween(state.doc, from, to))
}

/** The words between two places as a thread quotes them, an atom such as a mention by its own text. */
export function quoteBetween(doc: PMNode, from: number, to: number) {
  return doc.textBetween(from, to, ' ', atomText)
}

// The text the editor writes an atom out as, such as '@Ann' for a mention
function atomText(node: PMNode): string {
  return node.type.spec.toText?.({ node }) ?? ''
}

// The same place, held by the character after it (0) or before it (-1)
function positionAt(doc: yjs.Doc, position: yjs.RelativePosition, assoc: number) {
  const absolute = yjs.createAbsolutePositionFromRelativePosition(position, doc)!
  return yjs.createRelativePositionFromTypeIndex(absolute.type, absolute.index, assoc)
}

// A tab whose undo history keeps a deleted block would otherwise place the end where the block was
function isInDeletedBlock(doc: yjs.Doc, position: yjs.RelativePosition) {
  return yjs.createAbsolutePositionFromRelativePosition(position, doc)?.type._item?.deleted ?? false
}

// A range across blocks with no words left may still cover an atom or a block such as a rule
function holdsLeaf(doc: PMNode, from: number, to: number) {
  let hasLeaf = false
  doc.nodesBetween(from, to, (node) => {
    hasLeaf ||= node.isLeaf
    return !hasLeaf
  })
  return hasLeaf
}

// Yjs can't tell text not received yet from text deleted for good, so this asks first
function isInDoc(doc: yjs.Doc, position: yjs.RelativePosition) {
  const id = heldId(position)
  return !id || yjs.getState(doc.store, id.client) > id.clock
}
