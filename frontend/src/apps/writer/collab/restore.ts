import { createDocument, getSchema } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import * as yjs from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import { loadVersion, type Parent } from '@/apps/writer/collab/old-media'
import { writerSchema } from '@/apps/writer/schema'
import type { VersionBody } from '@/apps/writer/surface/versions'

const schema = getSchema(writerSchema())
const META = 'meta'

/**
 * Makes `current` exactly the version, in one transaction of this tab.
 *
 * A version of the same lineage is matched by Yjs identity: blocks and characters
 * both hold are kept, so threads and carets on them stay put. Any other version
 * is matched by content.
 */
export function restoreEdit(current: yjs.Doc, lineage: string, target: VersionBody) {
  const version = new yjs.Doc()
  // A dry run first, so a restore that fails leaves the document as it was
  const copy = new yjs.Doc()
  try {
    if ('state' in target) {
      loadVersion(version, target.state)
    }

    yjs.applyUpdate(copy, yjs.encodeStateAsUpdate(current))
    alignDocument(copy, lineage, target, version)
    alignDocument(current, lineage, target, version)
  } finally {
    copy.destroy()
    version.destroy()
  }
}

function alignDocument(doc: yjs.Doc, lineage: string, target: VersionBody, version: yjs.Doc) {
  const body = doc.getXmlFragment(BODY_FIELD)
  doc.transact(() => {
    if ('html' in target) {
      replaceBody(doc, body, createDocument(target.html, schema))
    } else if (target.lineage === lineage) {
      alignChildren(body, version.getXmlFragment(BODY_FIELD))
    } else {
      const root = yXmlFragmentToProseMirrorRootNode(version.getXmlFragment(BODY_FIELD), schema)
      replaceBody(doc, body, root)
    }

    alignMeta(doc.getMap(META), version.getMap(META))
  })
}

function replaceBody(doc: yjs.Doc, body: yjs.XmlFragment, root: PMNode) {
  updateYFragment(doc, body, root, {
    mapping: new Map(),
    isOMark: new Map(),
    hidden: new Set(),
    unbuildable: new Set(),
    lost: [],
  })
}

function alignMeta(current: yjs.Map<unknown>, version: yjs.Map<unknown>) {
  for (const key of [...current.keys()]) {
    if (!version.has(key)) {
      current.delete(key)
    }
  }

  for (const [key, value] of version.entries()) {
    if (!sameValue(current.get(key), value)) {
      current.set(key, value)
    }
  }
}

// The id of the item at `index`, which Yjs keeps for as long as the item exists
function idAt(type: Parent | yjs.XmlText, index: number): string {
  const item = yjs.createRelativePositionFromTypeIndex(type, index).item!

  return `${item.client}:${item.clock}`
}

function alignChildren(current: Parent, version: Parent) {
  const versionIds = version.toArray().map((_child, index) => idAt(version, index))
  const currentIds = current.toArray().map((_child, index) => idAt(current, index))
  const kept = new Set(versionIds)
  for (let index = currentIds.length - 1; index >= 0; index--) {
    if (!kept.has(currentIds[index])) {
      current.delete(index, 1)
    }
  }

  const held = new Set(currentIds)
  for (const [index, child] of version.toArray().entries()) {
    if (!held.has(versionIds[index])) {
      current.insert(index, [child.clone() as yjs.XmlElement | yjs.XmlText])
    } else if (child instanceof yjs.XmlText) {
      alignText(current.get(index) as yjs.XmlText, child)
    } else {
      const paired = current.get(index) as yjs.XmlElement
      alignAttributes(paired, child as yjs.XmlElement)
      alignChildren(paired, child as yjs.XmlElement)
    }
  }
}

function alignAttributes(current: yjs.XmlElement, version: yjs.XmlElement) {
  const wanted = version.getAttributes()
  for (const key of Object.keys(current.getAttributes())) {
    if (!(key in wanted)) {
      current.removeAttribute(key)
    }
  }

  for (const [key, value] of Object.entries(wanted)) {
    if (!sameValue(current.getAttribute(key), value)) {
      current.setAttribute(key, value as string)
    }
  }
}

interface Character {
  id: string
  // UTF-16 units: Yjs counts ids and indices in them, an emoji takes two
  index: number
  text: string
  attributes: Record<string, unknown>
}

function characters(text: yjs.XmlText): Character[] {
  const textChars: Character[] = []
  let index = 0
  for (const run of text.toDelta() as { insert: string; attributes?: Record<string, unknown> }[]) {
    for (const char of run.insert) {
      textChars.push({ id: idAt(text, index), index, text: char, attributes: run.attributes ?? {} })
      index += char.length
    }
  }

  return textChars
}

function alignText(current: yjs.XmlText, version: yjs.XmlText) {
  const wanted = characters(version)
  const kept = new Set(wanted.map((char) => char.id))
  const held = characters(current)
  for (const char of held.toReversed()) {
    if (!kept.has(char.id)) {
      current.delete(char.index, char.text.length)
    }
  }

  const heldIds = new Set(held.map((char) => char.id))
  for (const char of wanted) {
    if (!heldIds.has(char.id)) {
      current.insert(char.index, char.text, char.attributes)
    }
  }

  alignFormatting(current, wanted)
}

// The characters now pair up in order; give each the version's formatting
function alignFormatting(current: yjs.XmlText, wanted: Character[]) {
  const currentChars = characters(current)
  for (const [position, char] of wanted.entries()) {
    const currentAttributes = currentChars[position].attributes
    if (sameValue(currentAttributes, char.attributes)) {
      continue
    }

    const dropped = Object.keys(currentAttributes).filter((key) => !(key in char.attributes))
    const patch = { ...Object.fromEntries(dropped.map((key) => [key, null])), ...char.attributes }
    current.format(char.index, char.text.length, patch)
  }
}

// Key order differs between two copies of the same attributes
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sorted)
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  return Object.fromEntries(entries.map(([key, inner]) => [key, sorted(inner)]))
}
