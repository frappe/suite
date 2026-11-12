// What the server's checker (suite/content/checker.py, through checker-entry.ts)
// refuses in a Slides deck: anything the shape in deck.ts has no place for. A doc
// the tabs wrote must always pass, so no key is required: undo can restore an item
// without one, and reads already cope
//
// A reason names the root and the rule only, never a key or a value: reasons reach
// server logs, and a key or value can be a person's data

import { getSchema } from '@tiptap/core'
import { placeFragment } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

import { extensions } from '@/apps/slides/stores/tiptapSetup'

import { ELEMENT_KEYS, ROOT, SLIDE_KEYS } from './deck'

const schema = getSchema(extensions)
const KEYS_BY_ROOT = new Map<string, Set<string>>([
  [ROOT.slides, new Set(SLIDE_KEYS)],
  [ROOT.elements, new Set(ELEMENT_KEYS)],
])

// A fresh doc's roots are untyped until read, so this looks at the raw items
function holdsListItems(type: Pick<Y.AbstractType<unknown>, '_start'>) {
  for (let item = type._start; item; item = item.right) {
    if (!item.deleted) {
      return true
    }
  }

  return false
}

function valueFault(name: string, key: string, value: unknown) {
  if (key !== 'text') {
    if (value instanceof Y.AbstractType) {
      return `schema: ${name} holds a bad value`
    }

    return null
  }

  if (!(value instanceof Y.XmlFragment)) {
    return `schema: ${name} holds a bad value`
  }

  // The rule the editor freezes on
  if (placeFragment(value, schema).lost.length) {
    return `schema: ${name} holds text the editor cannot place`
  }

  return null
}

function itemFault(name: string, item: unknown) {
  if (!(item instanceof Y.Map)) {
    return `schema: ${name} holds a bad value`
  }

  for (const [key, value] of item.entries()) {
    if (!KEYS_BY_ROOT.get(name)?.has(key)) {
      return `schema: ${name} holds an unknown key`
    }

    const fault = valueFault(name, key, value)
    if (fault) {
      return fault
    }
  }

  return null
}

function rootFault(name: string, type: Pick<Y.AbstractType<unknown>, '_start'>) {
  if (!KEYS_BY_ROOT.has(name)) {
    return 'schema: unknown root'
  }

  if (holdsListItems(type)) {
    return `schema: ${name} is not a map`
  }

  return null
}

function firstFault<Item>(items: Iterable<Item>, faultOf: (item: Item) => string | null) {
  for (const item of items) {
    const fault = faultOf(item)
    if (fault) {
      return fault
    }
  }

  return null
}

/** Why the editor can't take `doc`, or null when it can */
export function slidesFault(doc: Y.Doc) {
  return (
    firstFault(doc.share, (entry) => {
      const [name, type] = entry

      return rootFault(name, type)
    }) ??
    firstFault(doc.share.keys(), (name) => {
      return firstFault(doc.getMap(name).values(), (item) => {
        return itemFault(name, item)
      })
    })
  )
}
