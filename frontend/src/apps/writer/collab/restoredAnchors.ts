import * as yjs from 'yjs'

import type { VersionBody } from '@/apps/writer/surface/versions'

import { encodeAnchor, heldId, readAnchor } from './anchors'
import { BODY_FIELD } from './field'
import { loadVersion, type Parent } from './old-media'

/** A thread as Drive lists it, by name with its stored anchor. */
export interface AnchoredThread {
  name: string
  anchor: string
}

/**
 * New anchors, by thread, for threads a restore brought back: text the document
 * lost and the version holds, which the restore made again as new characters.
 * Run right after the restore, while the document equals the version.
 */
export function restoredAnchors(
  current: yjs.Doc,
  lineage: string,
  target: VersionBody,
  threads: AnchoredThread[],
) {
  if (!('state' in target) || target.lineage !== lineage) {
    return {}
  }

  const version = new yjs.Doc()
  try {
    loadVersion(version, target.state)
    return anchorsIn(current, version, threads)
  } finally {
    version.destroy()
  }
}

function anchorsIn(current: yjs.Doc, version: yjs.Doc, threads: AnchoredThread[]) {
  const anchors: Record<string, string> = {}
  for (const thread of threads) {
    const anchor = restoredAnchor(current, version, thread.anchor)
    if (anchor) {
      anchors[thread.name] = anchor
    }
  }

  return anchors
}

function restoredAnchor(current: yjs.Doc, version: yjs.Doc, anchor: string) {
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
function isLive(doc: yjs.Doc, position: yjs.RelativePosition) {
  const absolute = yjs.createAbsolutePositionFromRelativePosition(position, doc)
  if (!absolute) {
    return false
  }

  const again = yjs.createRelativePositionFromTypeIndex(
    absolute.type,
    absolute.index,
    position.assoc,
  )
  return isSameId(heldId(position), heldId(again))
}

function isSameId(left: yjs.ID | null, right: yjs.ID | null) {
  return left !== null && right !== null && yjs.compareIDs(left, right)
}

// The version's spot in the document, found by its path, as the two now match
function sameSpot(current: yjs.Doc, version: yjs.Doc, position: yjs.RelativePosition) {
  const absolute = yjs.createAbsolutePositionFromRelativePosition(position, version)!
  const path = pathOf(version.getXmlFragment(BODY_FIELD), absolute.type)
  const type = path && typeAt(current.getXmlFragment(BODY_FIELD), path)
  if (!(type instanceof yjs.XmlText) || absolute.index > type.length) {
    return null
  }

  return yjs.createRelativePositionFromTypeIndex(type, absolute.index, position.assoc)
}

function pathOf(body: yjs.XmlFragment, type: yjs.AbstractType<unknown>) {
  const path: number[] = []
  let child: yjs.AbstractType<unknown> | Parent = type
  while (child !== body) {
    const parent = child.parent as Parent | null
    if (!parent) {
      return null
    }

    path.unshift(parent.toArray().indexOf(child as yjs.XmlElement))
    child = parent
  }

  return path
}

function typeAt(body: yjs.XmlFragment, path: number[]) {
  let node: Parent | yjs.XmlText | undefined = body
  for (const index of path) {
    if (!(node instanceof yjs.XmlFragment || node instanceof yjs.XmlElement)) {
      return null
    }

    node = node.get(index) as Parent | yjs.XmlText | undefined
  }

  return node ?? null
}
