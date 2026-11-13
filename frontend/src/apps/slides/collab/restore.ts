import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

import { ROOT } from './deck'
import { deckSchema } from './drawnDeck'

type Item = Y.Map<unknown>

/**
 * Makes `current` exactly the version whose Yjs state is `state`, in one transaction of this tab.
 * Every slide and element the version holds is set to its values, and the rest are removed. A slide
 * or element both hold stays the same item, and its text goes through `updateYFragment`, so carets
 * and selections on it stay put.
 */
export function restoreEdit(current: Y.Doc, state: Uint8Array) {
  const version = new Y.Doc()
  // A dry run first, so a restore that fails leaves the presentation as it was
  const copy = new Y.Doc()
  try {
    Y.applyUpdate(version, state)
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(current))
    alignDeck(copy, version)
    alignDeck(current, version)
  } finally {
    copy.destroy()
    version.destroy()
  }
}

function alignDeck(doc: Y.Doc, version: Y.Doc) {
  doc.transact(() => {
    for (const root of Object.values(ROOT)) {
      alignRoot(doc, doc.getMap<Item>(root), version.getMap<Item>(root))
    }
  })
}

function alignRoot(doc: Y.Doc, current: Y.Map<Item>, version: Y.Map<Item>) {
  for (const id of [...current.keys()]) {
    if (!version.has(id)) {
      current.delete(id)
    }
  }

  for (const [id, wanted] of version.entries()) {
    let item = current.get(id)
    if (!item) {
      item = new Y.Map()
      current.set(id, item)
    }

    alignItem(doc, item, wanted)
  }
}

function alignItem(doc: Y.Doc, current: Item, version: Item) {
  for (const key of [...current.keys()]) {
    if (!version.has(key)) {
      current.delete(key)
    }
  }

  for (const [key, value] of version.entries()) {
    if (value instanceof Y.XmlFragment) {
      alignText(doc, current, key, value)
    } else if (!sameValue(current.get(key), value)) {
      current.set(key, value)
    }
  }
}

function alignText(doc: Y.Doc, current: Item, key: string, version: Y.XmlFragment) {
  const held = current.get(key)
  let text: Y.XmlFragment
  if (held instanceof Y.XmlFragment) {
    text = held
  } else {
    text = new Y.XmlFragment()
    current.set(key, text)
  }

  updateYFragment(doc, text, yXmlFragmentToProseMirrorRootNode(version, deckSchema), {
    mapping: new Map(),
    isOMark: new Map(),
    hidden: new Set(),
    unbuildable: new Set(),
    lost: [],
  })
}

// Key order differs between two copies of the same value
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
