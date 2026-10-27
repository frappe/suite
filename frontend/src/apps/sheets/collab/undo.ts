// Undo and redo for a collab tab: only this tab's own steps, never anyone
// else's (COLLAB-DESIGN Oct 14, Q17). Replaces useHistory.js when collab is on.
//
//   glue.commit() ──localOrigin──▶ Y.Doc ──▶ Yjs UndoManager: one step per commit
//   undo() ──▶ UndoManager writes the reverse into the doc ──▶ the glue applies
//              it to IronCalc and the side stores, as it does a remote change
//
// A step is one glue.commit(): one user action. A commit that changed nothing
// makes no step (ISSUES #11, #15).
//
// Refusals, checked before a step is undone or redone. A refused step is
// dropped, so the next Ctrl+Z goes to the step before it:
// - The step inserted a row, column or sheet, and another tab has put
//   something there since (a value, format, comment, validation, row/col
//   format, or a sheet rename). Undoing would delete their work. (Q17)
// - Every cell the step changed has been changed again by another tab since.
//   Yjs never overwrites their value, so the step would do nothing (and plain
//   Yjs would quietly undo the step before it instead).
// When only some of its cells were changed by another tab, the step is undone
// for the rest and the result says 'partial'.
//
// Never undone: grown rows/cols (tail ids, schema.ts) and the `tails`
// high-water marks. Growing a list moves nothing, and another tab may already
// have typed in the grown rows; lowering a mark would hand a deleted tail
// name out again.
//
// Each step remembers the selection the action was made with, by row/col id,
// and undo/redo hand it back so the editor can select it (ISSUES #16).

import * as Y from 'yjs'

import type { Glue } from './glue'
import {
  axis,
  isTailId,
  parseCellKey,
  parseLineKey,
  parseStateKey,
  roots,
  type AxisName,
  type Roots,
} from './schema'
import { docSheets } from './stores'

/** A selected range: sheet name and 0-based positions, as the canvas has them. */
export interface Selection {
  sheet: string
  r0: number
  c0: number
  r1: number
  c1: number
}

interface UndoResult {
  /** Whether the doc changed. */
  done: boolean
  /**
   * 'edited': refused, someone else edited it since (the step is dropped).
   * 'partial': undone, except the cells someone else edited since.
   */
  refused?: 'edited' | 'partial'
  /** Where the step was made, to select; null when it is gone (its row was deleted). */
  selection?: Selection | null
}

export interface Undo {
  /** Undo this tab's last step. Commits an open action first and waits for the glue. */
  undo(): Promise<UndoResult>
  redo(): Promise<UndoResult>
  canUndo(): boolean
  canRedo(): boolean
  /** Called whenever canUndo/canRedo may have changed (ISSUES #13). */
  onChange(cb: () => void): () => void
  stop(): void
}

export interface UndoOptions {
  doc: Y.Doc
  glue: Glue
  /** The editor's selection when an action is committed. */
  getSelection?: () => Selection | null
  /** Oldest steps are dropped beyond this many. */
  maxSteps?: number
}

// A selection by row/col id, so it follows rows other tabs insert or delete.
// Past the end of an id list there are no ids yet: those ends keep a position.
type End = string | number
interface SavedSelection {
  sheetId: string
  r0: End
  c0: End
  r1: End
  c1: End
}

const SELECTION = 'selection'

// Yjs doesn't export these types by name.
type StackItem = Y.UndoManager['undoStack'][number]
type DeleteSet = StackItem['deletions']
// A root map, read only for the latest entry of a key.
type EntryMap = { _map: Map<string, Y.Item> }

// Maps keyed by cell key (sheetId:rowId:colId).
const CELL_MAPS = ['inputs', 'formats', 'comments', 'validations'] as const
// Maps keyed by sheetId:rowId / sheetId:colId.
const LINE_MAPS = ['rowFormats', 'colFormats'] as const
// Maps whose items carry the sheet they belong to as `sheet`.
const ITEM_MAPS = ['condFormats', 'slicers'] as const

/** What one step did, read from its insertions and deletions. */
interface Step {
  /** Row/col ids it inserted (not grown), by sheet id. */
  lines: Map<string, Set<string>>
  /** Sheet ids it added. */
  sheets: Set<string>
  /** Whether it inserted or deleted anything in a list (rows, cols, sheets). */
  listChange: boolean
  /** Map entries it wrote or deleted. */
  keys: { map: EntryMap; key: string }[]
}

export function createUndo({ doc, glue, getSelection, maxSteps = 100 }: UndoOptions): Undo {
  const r = roots(doc)
  // Everything but `meta` (schemaVersion) and `tails` (see the top).
  const scope = (Object.keys(r) as (keyof Roots)[])
    .filter((name) => name !== 'meta' && name !== 'tails')
    .map((name) => r[name] as Y.AbstractType<unknown>)
  const scopeSet = new Set<unknown>(scope)

  const um = new Y.UndoManager(scope, {
    trackedOrigins: new Set([glue.localOrigin]),
    captureTimeout: 0, // one commit, one step
    deleteFilter: (item) => !isGrowth(item),
  })

  const listeners = new Set<() => void>()
  const changed = () => {
    for (const cb of listeners) cb()
  }

  // The selection a step being undone/redone was made with: it moves to the
  // step Yjs creates on the other stack.
  let carry: SavedSelection | null | undefined

  um.on('stack-item-added', ({ stackItem, type }) => {
    stackItem.meta.set(SELECTION, carry !== undefined ? carry : saveSelection())
    if (type === 'undo' && um.undoStack.length > maxSteps) um.undoStack.shift()
    changed()
  })
  um.on('stack-item-popped', changed)
  um.on('stack-cleared', changed)

  // ---- grown rows/cols ----

  // The Y.Array of row/col ids an item sits in, with its sheet id, if any.
  function listOf(item: Y.Item): { sheetId: string; name: AxisName } | null {
    const parent = item.parent
    if (!(parent instanceof Y.Array)) return null
    const owner = parent._item
    if (!owner || typeof owner.parentSub !== 'string') return null
    if (owner.parent === r.rows) return { sheetId: owner.parentSub, name: 'rows' }
    if (owner.parent === r.cols) return { sheetId: owner.parentSub, name: 'cols' }
    return null
  }

  function isGrowth(item: Y.Item): boolean {
    return !!listOf(item) && item.content.getContent().every((id) => isTailId(String(id)))
  }

  // ---- what a step did ----

  function readStep(stackItem: StackItem): Step {
    const step: Step = { lines: new Map(), sheets: new Set(), listChange: false, keys: [] }
    const seen = new Set<string>()
    const visit = (inserted: boolean) => (struct: Y.Item | Y.GC) => {
      if (!(struct instanceof Y.Item)) return
      const parent = struct.parent
      if (struct.parentSub !== null && scopeSet.has(parent)) {
        const id = `${rootName(parent)}\u0000${struct.parentSub}`
        if (!seen.has(id)) {
          seen.add(id)
          step.keys.push({ map: parent as unknown as EntryMap, key: struct.parentSub })
        }
        return
      }
      if (parent === r.sheets) {
        step.listChange = true
        if (inserted) for (const id of struct.content.getContent()) step.sheets.add(String(id))
        return
      }
      const list = listOf(struct)
      if (!list || isGrowth(struct)) return
      step.listChange = true
      if (!inserted) return
      if (!step.lines.has(list.sheetId)) step.lines.set(list.sheetId, new Set())
      for (const id of struct.content.getContent()) step.lines.get(list.sheetId)!.add(String(id))
    }
    // Reading needs a transaction (Yjs may split items at the edges). It
    // changes nothing, so neither the glue nor the UndoManager record it.
    doc.transact((tr) => {
      Y.iterateDeletedStructs(tr, stackItem.insertions, visit(true))
      Y.iterateDeletedStructs(tr, stackItem.deletions, visit(false))
    })
    return step
  }

  const nameOfRoot = new Map<unknown, string>(Object.entries(r).map(([n, t]) => [t, n]))
  const rootName = (type: unknown) => nameOfRoot.get(type) ?? ''

  // The entry a key holds now, if another tab wrote it.
  function byOther(map: EntryMap, key: string): boolean {
    const item = map._map.get(key)
    return !!item && !item.deleted && item.id.client !== doc.clientID
  }

  // Whether another tab has put anything on a row, column or sheet the step inserted (Q17).
  function othersOnInserted(step: Step): boolean {
    if (!step.lines.size && !step.sheets.size) return false
    const onLine = (sheetId: string, id: string) =>
      step.sheets.has(sheetId) || !!step.lines.get(sheetId)?.has(id)
    for (const name of CELL_MAPS) {
      for (const key of r[name].keys()) {
        const k = parseCellKey(key)
        if (
          k &&
          (onLine(k.sheetId, k.rowId) || onLine(k.sheetId, k.colId)) &&
          byOther(r[name], key)
        )
          return true
      }
    }
    for (const name of LINE_MAPS) {
      for (const key of r[name].keys()) {
        const k = parseLineKey(key)
        if (k && onLine(k.sheetId, k.id) && byOther(r[name], key)) return true
      }
    }
    if (!step.sheets.size) return false
    for (const sheetId of step.sheets) if (byOther(r.sheetMeta, sheetId)) return true
    for (const key of r.sheetState.keys()) {
      const k = parseStateKey(key)
      if (k && step.sheets.has(k.sheetId) && byOther(r.sheetState, key)) return true
    }
    for (const name of ITEM_MAPS) {
      for (const [key, value] of r[name].entries()) {
        const sheet = (value as { sheet?: string } | undefined)?.sheet
        if (sheet && step.sheets.has(sheet) && byOther(r[name], key)) return true
      }
    }
    return false
  }

  // Of the entries the step wrote or deleted, how many another tab has
  // changed since. Yjs leaves those alone: undoing the step can't reach them.
  function changedByOthers(step: Step, deletions: DeleteSet): number {
    let n = 0
    for (const { map, key } of step.keys) {
      const item = map._map.get(key)
      if (!item) continue
      // Alive: written by another tab? Deleted, and not by this step: every
      // later step of this tab is undone already, so another tab deleted it.
      if (item.deleted ? !Y.isDeleted(deletions, item.id) : item.id.client !== doc.clientID) n++
    }
    return n
  }

  // ---- selection ----

  function saveSelection(): SavedSelection | null {
    const sel = getSelection?.()
    if (!sel) return null
    const sheetId = docSheets(doc).find((s) => s.name === sel.sheet)?.id
    if (!sheetId) return null
    const end = (name: AxisName, pos: number): End => axis(doc, sheetId, name).idAt(pos) ?? pos
    return {
      sheetId,
      r0: end('rows', sel.r0),
      c0: end('cols', sel.c0),
      r1: end('rows', sel.r1),
      c1: end('cols', sel.c1),
    }
  }

  function resolveSelection(saved: SavedSelection | null | undefined): Selection | null {
    if (!saved) return null
    const sheet = docSheets(doc).find((s) => s.id === saved.sheetId)?.name
    if (sheet === undefined) return null
    const pos = (name: AxisName, end: End) =>
      typeof end === 'number' ? end : axis(doc, saved.sheetId, name).posOf(end)
    const sel = {
      sheet,
      r0: pos('rows', saved.r0),
      c0: pos('cols', saved.c0),
      r1: pos('rows', saved.r1),
      c1: pos('cols', saved.c1),
    }
    return sel.r0 < 0 || sel.c0 < 0 || sel.r1 < 0 || sel.c1 < 0 ? null : sel
  }

  // ---- undo / redo ----

  let chain: Promise<unknown> = Promise.resolve()

  function run(which: 'undo' | 'redo'): Promise<UndoResult> {
    const next = chain.then(() => step(which))
    chain = next.catch(() => {})
    return next
  }

  async function step(which: 'undo' | 'redo'): Promise<UndoResult> {
    // An action still open becomes its own step first: undo's writes reach
    // the glue directly, not through receive(), which would hold them.
    await glue.commit()
    await glue.settled()
    const stack = which === 'undo' ? um.undoStack : um.redoStack
    const top = stack[stack.length - 1]
    if (!top) return { done: false }
    const saved = top.meta.get(SELECTION) as SavedSelection | null | undefined
    const info = readStep(top)
    const blocked = changedByOthers(info, top.deletions)
    if (
      othersOnInserted(info) ||
      (blocked > 0 && blocked === info.keys.length && !info.listChange)
    ) {
      stack.pop()
      changed()
      return { done: false, refused: 'edited' }
    }
    // Yjs pops steps until one changes something; hide the older ones so one
    // Ctrl+Z is never two steps.
    const older = stack.splice(0, stack.length - 1)
    carry = saved
    let done: boolean
    try {
      done = (which === 'undo' ? um.undo() : um.redo()) !== null
    } finally {
      carry = undefined
      stack.unshift(...older)
    }
    await glue.settled()
    // A step can only come to nothing because another tab changed what it
    // touched (this tab's later steps are undone already); it is gone.
    if (!done) {
      changed()
      return { done, refused: 'edited' }
    }
    return {
      done,
      ...(blocked > 0 && { refused: 'partial' as const }),
      selection: resolveSelection(saved),
    }
  }

  return {
    undo: () => run('undo'),
    redo: () => run('redo'),
    canUndo: () => um.undoStack.length > 0,
    canRedo: () => um.redoStack.length > 0,
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    stop() {
      listeners.clear()
      um.destroy()
    },
  }
}
