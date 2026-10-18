import * as Y from 'yjs'

import type { VersionBody } from '@/apps/writer/surface/versions'

import { encodeAnchor, readAnchor } from './anchors'
import { BODY_FIELD } from './field'
import { loadVersion } from './old-media'

/** A thread as Drive lists it, by name with its stored anchor. */
export interface AnchoredThread {
  name: string
  anchor: string
}

type Parent = Y.XmlFragment | Y.XmlElement

/**
 * New anchors, by thread, for threads a restore brought back: text the document
 * lost and the version holds, which the restore made again as new characters.
 * Run right after the restore, while the document equals the version.
 */
export function restoredAnchors(
  current: Y.Doc,
  lineage: string,
  target: VersionBody,
  threads: AnchoredThread[],
) {
  if (!('state' in target) || target.lineage !== lineage) {
    return {}
  }

  const version = new Y.Doc()
  try {
    loadVersion(version, target.state)
    return anchorsIn(current, version, threads)
  } finally {
    version.destroy()
  }
}

function anchorsIn(current: Y.Doc, version: Y.Doc, threads: AnchoredThread[]) {
  const anchors: Record<string, string> = {}
  for (const thread of threads) {
    const anchor = restoredAnchor(current, version, thread.anchor)
    if (anchor) {
      anchors[thread.name] = anchor
    }
  }

  return anchors
}

function restoredAnchor(current: Y.Doc, version: Y.Doc, anchor: string) {
  const read = readAnchor(anchor)
  if (read.kind !== 'text') {
    return null
  }

  const ends = [read.start, read.end]
  const isOnItsText = ends.every((end) => isLive(current, end))
  if (isOnItsText || !ends.every((end) => isLive(version, end))) {
    return null
  }

  const start = sameSpot(current, version, read.start)
  const end = sameSpot(current, version, read.end)
  if (!start || !end) {
    return null
  }

  return encodeAnchor(start, end, read.quote)
}

// Whether the character a position holds on to is in the document, not deleted
function isLive(doc: Y.Doc, position: Y.RelativePosition) {
  const absolute = Y.createAbsolutePositionFromRelativePosition(position, doc)
  if (!absolute) {
    return false
  }

  const again = Y.createRelativePositionFromTypeIndex(absolute.type, absolute.index, position.assoc)
  return isSameId(heldId(position), heldId(again))
}

// A stored position keeps only the character it holds, or its block when it holds none
function heldId(position: Y.RelativePosition) {
  return position.item ?? position.type
}

function isSameId(left: Y.ID | null, right: Y.ID | null) {
  return left !== null && right !== null && Y.compareIDs(left, right)
}

// The version's spot in the document, found by its path, as the two now match
function sameSpot(current: Y.Doc, version: Y.Doc, position: Y.RelativePosition) {
  const absolute = Y.createAbsolutePositionFromRelativePosition(position, version)!
  const path = pathOf(version.getXmlFragment(BODY_FIELD), absolute.type)
  const type = path && typeAt(current.getXmlFragment(BODY_FIELD), path)
  if (!(type instanceof Y.XmlText) || absolute.index > type.length) {
    return null
  }

  return Y.createRelativePositionFromTypeIndex(type, absolute.index, position.assoc)
}

function pathOf(body: Y.XmlFragment, type: Y.AbstractType<unknown>) {
  const path: number[] = []
  let child: Y.AbstractType<unknown> | Parent = type
  while (child !== body) {
    const parent = child.parent as Parent | null
    if (!parent) {
      return null
    }

    path.unshift(parent.toArray().indexOf(child as Y.XmlElement))
    child = parent
  }

  return path
}

function typeAt(body: Y.XmlFragment, path: number[]) {
  let node: Parent | Y.XmlText | undefined = body
  for (const index of path) {
    if (!(node instanceof Y.XmlFragment || node instanceof Y.XmlElement)) {
      return null
    }

    node = node.get(index) as Parent | Y.XmlText | undefined
  }

  return node ?? null
}
