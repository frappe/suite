// Turns an old sheet (`Sheet.sheets_data`) into a collab doc, for the server's
// converter (converter-entry.ts, run by suite/content/convert.py). It reuses
// what the browser already trusts: a develop body is typed in by
// utils/legacy-sheet.ts as the editor's upgrade does, and the doc is written by
// load.ts `writeWorkbookToDoc`, as a tab opening the sheet would write it.
//
// IronCalc runs in this process (no Worker): the caller loads its wasm first.
// `sheets_data` is never written; a refused sheet keeps working on the old path.

import * as Y from 'yjs'

import { createWorkbookClient, type WorkbookClient } from '../core/client'
import { base64ToBytes } from '../core/snapshot-codec'
import { createWorkerHost } from '../core/worker'
import { createChartEngine } from '../engine/charts'
import { createCommentsEngine } from '../engine/comments'
import { createCondFormatEngine } from '../engine/cond-format'
import { createFormatsEngine } from '../engine/formats'
import { createMergeEngine } from '../engine/merge'
import { createNamedRanges } from '../engine/named-ranges'
import { createPivotEngine } from '../engine/pivot'
import { createProtectionEngine } from '../engine/protection'
import { createSlicerEngine } from '../engine/slicers'
import { createValidationEngine } from '../engine/validation'
import { applyLegacyPlan, planLegacySheet } from '../utils/legacy-sheet'
import { unpackSheet } from '../utils/sheet-codec'
import { docToHtml } from './html'
import { writeWorkbookToDoc } from './load'
import type { GlueStores } from './stores'

/** Something the conversion changed or left out, for the conversion's record. */
type Dropped =
  { kind: 'renamed-sheet'; from: string; to: string } | { kind: 'skipped-cells'; count: number }

/** The converter's answer, in the shape suite/content/convert.py reads. */
export type ConverterAnswer =
  | {
      kind: 'converted'
      state: Uint8Array
      // convert.py takes "yjs" or "html" for where the state came from; Sheets'
      // old body is neither, and nothing reads it, so it answers "yjs".
      from: 'yjs'
      dropped: Dropped[]
      // Writer's comment anchors and threads; a sheet's comments are Drive's already.
      anchors: Record<string, never>
      threads: never[]
      html: string
    }
  | { kind: 'failed'; reason: 'too_large' | 'check' }

/** A workbook whose IronCalc runs in this process, started from `bytes` (or empty). */
export function inProcessClient(bytes: Uint8Array | null): Promise<WorkbookClient> {
  const host = createWorkerHost()
  const port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage(message: unknown) {
      setTimeout(() => port.onmessage?.({ data: host.handle(structuredClone(message)) }), 0)
    },
  }
  return createWorkbookClient({ port, snapshotBytes: bytes })
}

// A store that only keeps a snapshot (the per-sheet view, filters).
function held(): {
  snapshot(): Record<string, unknown>
  restore(v: Record<string, unknown>): void
} {
  let value: Record<string, unknown> = {}
  return { snapshot: () => structuredClone(value), restore: (v) => (value = v) }
}

function sideStores() {
  return {
    formats: createFormatsEngine(),
    comments: createCommentsEngine(),
    validation: createValidationEngine(),
    merge: createMergeEngine(),
    protection: createProtectionEngine(),
    sortFilter: held(),
    view: held(),
    condFormat: createCondFormatEngine(),
    slicers: createSlicerEngine(),
    charts: createChartEngine(),
    pivot: createPivotEngine(),
    namedRanges: createNamedRanges(),
  }
}

type Saved = Record<string, unknown>

// A develop body's `sheet` that is there but holds no readable sheets: refused,
// so a bad body never converts to an empty sheet.
function isUnreadableDevelop(sheet: unknown): boolean {
  if (sheet == null) return false
  const snap = unpackSheet(sheet) as { sheets?: unknown } | null
  return !snap || typeof snap !== 'object' || !snap.sheets || typeof snap.sheets !== 'object'
}

// A develop body's view is one flat view (no sheet names), for the sheet it had open.
function isFlatView(view: Record<string, unknown>): boolean {
  return 'colW' in view || 'rowH' in view || 'freezeRows' in view
}

function renameKeys(snap: unknown, renamed: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries((snap ?? {}) as Record<string, unknown>).map(([k, v]) => [renamed[k] ?? k, v]),
  )
}

/**
 * Convert `sheetsData` (the stored JSON, decoded) to a collab doc's state and
 * readable copy, refusing a body it can't read or a doc over `maxState` bytes.
 */
export async function convertSheetsData(
  sheetsData: string | null,
  maxState: number,
): Promise<ConverterAnswer> {
  let saved: Saved
  try {
    saved = JSON.parse(sheetsData || '{}') as Saved
  } catch {
    return { kind: 'failed', reason: 'check' }
  }
  // The gzip envelope is suite/sheets/doctype/sheet/storage.py's: the server
  // decodes it first, so one here could not be read.
  if (!saved || typeof saved !== 'object' || '_z' in saved || isUnreadableDevelop(saved.sheet)) {
    return { kind: 'failed', reason: 'check' }
  }

  let engine: Uint8Array | null
  let client: WorkbookClient
  try {
    engine = typeof saved.engine === 'string' ? base64ToBytes(saved.engine) : null
    client = await inProcessClient(engine)
  } catch {
    // The bytes are not base64, or IronCalc could not open them (another version's, or not IronCalc's).
    return { kind: 'failed', reason: 'check' }
  }
  // Anything else that throws is a converter bug, not a bad sheet: the child
  // fails and the server counts it as a crash, which it tries again.
  try {
    const dropped: Dropped[] = []
    const plan = engine ? null : planLegacySheet(saved.sheet)
    const renamed = plan?.renamed ?? {}
    if (plan) {
      if (!(await applyLegacyPlan(client, plan)).ok) return { kind: 'failed', reason: 'check' }
      for (const [from, to] of Object.entries(renamed))
        dropped.push({ kind: 'renamed-sheet', from, to })
      if (plan.skipped) dropped.push({ kind: 'skipped-cells', count: plan.skipped })
    }
    await client.idle()

    const stores = sideStores()
    const restore: [keyof typeof stores, unknown][] = [
      ['formats', saved.formats],
      ['merge', saved.merge],
      // A develop sheet's comments became Drive threads when Drive adopted it.
      ['comments', plan ? null : saved.comments],
      ['validation', saved.validation],
      ['protection', saved.protection],
      ['condFormat', saved.condFormat],
      ['slicers', saved.slicers],
      ['pivot', saved.pivot],
      ['charts', saved.charts],
      ['namedRanges', saved.namedRanges],
    ]
    for (const [name, snap] of restore) {
      if (snap) (stores[name].restore as (s: unknown) => void)(snap)
    }
    const view = (saved.view ?? {}) as Record<string, unknown>
    stores.view.restore(
      isFlatView(view) ? { [plan?.current ?? client.sheets[0]!]: view } : renameKeys(view, renamed),
    )
    stores.sortFilter.restore(renameKeys(saved.sortFilter, renamed))
    for (const [from, to] of Object.entries(renamed)) {
      for (const store of Object.values(stores)) {
        if ('renameSheet' in store) store.renameSheet(from, to)
      }
    }

    const doc = new Y.Doc()
    await writeWorkbookToDoc(doc, client, stores as GlueStores)
    const state = Y.encodeStateAsUpdate(doc)
    if (state.length > maxState) return { kind: 'failed', reason: 'too_large' }
    return {
      kind: 'converted',
      state,
      from: 'yjs',
      dropped,
      anchors: {},
      threads: [],
      html: docToHtml(doc),
    }
  } finally {
    client.terminate()
  }
}
