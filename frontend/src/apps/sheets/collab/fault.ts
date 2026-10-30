// What the server's checker (suite/content/checker.py, through checker-entry.ts)
// refuses in a Sheets doc: anything the layout in schema.ts has no place for.
// The checker runs it on a doc rebuilt from stored rows to find the row that
// broke a document, so a doc the glue wrote must always pass.
//
// A reason names the root and the rule only, never a key or a value: reasons
// reach server logs, and a key or value can be a person's data.

import * as Y from 'yjs'

import { ROOT } from './schema'

const ROOT_NAMES = new Set<string>(Object.values(ROOT))
// The one root that is a list; every other root is a map.
const LIST_ROOTS = new Set<string>([ROOT.sheets])

type Rule = (value: unknown) => boolean

const isString: Rule = (v) => typeof v === 'string'
const isNumber: Rule = (v) => typeof v === 'number' && Number.isFinite(v)
// What the glue stores as JSON: never a shared type or bytes.
const isPlain: Rule = (v) => !(v instanceof Y.AbstractType) && !(v instanceof Uint8Array)
const isIdList: Rule = (v) => v instanceof Y.Array && v.toArray().every(isString)

// The rule for each map root's values; a root not listed holds plain JSON.
const VALUE_RULES: Record<string, Rule> = {
  [ROOT.inputs]: (v) => isString(v) || isNumber(v),
  [ROOT.sheetMeta]: (v) =>
    isPlain(v) && typeof v === 'object' && v !== null && isString((v as { name?: unknown }).name),
  [ROOT.rows]: isIdList,
  [ROOT.cols]: isIdList,
  [ROOT.tails]: isNumber,
}

// Whether a root holds live entries of the other kind: list items in a map,
// keys in a list. A fresh doc's roots are untyped until read, so this looks at
// the raw items.
function holdsListItems(type: Y.AbstractType<unknown>): boolean {
  for (let item = type._start; item; item = item.right) if (!item.deleted) return true
  return false
}

function holdsMapEntries(type: Y.AbstractType<unknown>): boolean {
  for (const item of type._map.values()) if (!item.deleted) return true
  return false
}

/** Why the editor can't take `doc`, or null when it can. */
export function sheetsFault(doc: Y.Doc): string | null {
  for (const [name, type] of doc.share) {
    if (!ROOT_NAMES.has(name)) return 'schema: unknown root'
    if (LIST_ROOTS.has(name) && holdsMapEntries(type)) return `schema: ${name} is not a list`
    if (!LIST_ROOTS.has(name) && holdsListItems(type)) return `schema: ${name} is not a map`
  }

  for (const name of doc.share.keys()) {
    if (LIST_ROOTS.has(name)) {
      if (!doc.getArray(name).toArray().every(isString)) return `schema: ${name} holds a bad value`
      continue
    }
    const rule = VALUE_RULES[name] ?? isPlain
    for (const value of doc.getMap(name).values()) {
      if (!rule(value)) return `schema: ${name} holds a bad value`
    }
  }
  return null
}
