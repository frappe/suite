import { ref } from 'vue'

import { api, client } from '@/api'

import { base64ToBytes, bytesToBase64, ENGINE_VERSION } from '../../core/snapshot-codec'
import { decodeFromDownload, isDecompressionSupported } from '../../utils/compress.js'
import { applyLegacyPlan, planLegacySheet } from '../../utils/legacy-sheet'
import { isRefusal } from '../../utils/relay.js'

// The sheet's old body (`sheets_data`), read-only. The live room saves every
// edit (useCollabRoom.ts); this only shows a sheet the room can't open — a
// guest's, one still waiting for its conversion, or one the converter
// refused — and builds the whole workbook as JSON for the surface's recovery
// copy.
//
// `merge` and the view-state getters/setters are optional — they were missing
// from earlier versions and their absence caused merged cells / column widths /
// freeze panes / hidden cols/rows to silently disappear on load.
//
// Options, all optional:
//   - `requestContext` — use the open document's Drive access scope. The `/d/`
//     surface passes the Drive session's, which adds its link credentials.
export function usePersistence({
  // IronCalc: start(bytes | null) builds the workbook, toBytes() reads it back,
  // client() is the running workbook client, syncDefinedNames() sends it the
  // named ranges.
  engine,
  formats,
  merge,
  comments,
  validation,
  protection,
  condFormat,
  sortFilter,
  slicers,
  pivot,
  charts,
  namedRanges,
  getViewState,
  applyViewState,
  currentTitle,
  requestContext,
}) {
  // Surfaces "couldn't open this sheet" cases (404 / 403 / network) to the
  // editor so it can render a proper error screen instead of mounting a
  // blank canvas. Shape: { kind: 'denied' | 'missing' | 'other', message }.
  const loadError = ref(null)
  // The tab a body last saved by the develop editor had open; null for any
  // other sheet.
  const legacyCurrent = ref(null)
  const sideStores = [
    merge,
    comments,
    validation,
    protection,
    condFormat,
    sortFilter,
    slicers,
    pivot,
    charts,
    namedRanges,
  ]
  async function loadSheet(name) {
    loadError.value = null
    try {
      const canGz = isDecompressionSupported()
      const doc = await client.query(
        api.sheets.documents.get,
        {
          name,
          compressed: canGz ? 1 : 0,
        },
        {
          context: requestContext,
        },
      )
      const plain = canGz ? await decodeFromDownload(doc.sheets_data) : doc.sheets_data
      await loadBody(JSON.parse(plain || '{}'), { inDrive: Boolean(doc.node) })
      currentTitle.value = doc.title
      return doc
    } catch (err) {
      console.error('Load failed:', err)
      const t = err?.type || ''
      const kind =
        t === 'DoesNotExistError' || t === 'DriveNotFound'
          ? 'missing'
          : isRefusal(err)
            ? 'denied'
            : 'other'
      loadError.value = {
        kind,
        message: err?.message || 'Could not open this sheet',
      }
      return null
    }
  }

  // Builds the workbook from one old body (`sheets_data`, parsed): the sheet's
  // own, or a stored version of it. `inDrive`: Drive keeps the sheet's
  // comments, so a develop body's are not restored.
  async function loadBody(saved, { inDrive }) {
    if (saved.formats) formats.restore(saved.formats)
    await _startEngine(saved)
    // A sheet last saved by the develop editor: its cells are typed into
    // IronCalc here (utils/legacy-sheet.ts); the side stores below restore
    // from its old shapes as they are.
    const plan = saved.engine ? null : planLegacySheet(saved.sheet)
    const converted = plan ? await applyLegacyPlan(engine.client(), plan) : null
    if (converted && !converted.ok)
      console.error('[sheets] could not convert a develop sheet:', converted.error)
    const renamed = converted?.ok ? Object.entries(plan.renamed) : []
    if (renamed.length && saved.view) saved.view = _renameKeys(saved.view, plan.renamed)
    if (saved.merge && merge?.restore) merge.restore(saved.merge)
    // Drive owns a develop sheet's comments: the migration made them Drive
    // threads and stripped them from the body. A develop body that still has
    // them is an old version restored; restoring them would show each twice.
    const commentsInDrive = plan && inDrive
    if (saved.comments && comments?.restore && !commentsInDrive) comments.restore(saved.comments)
    if (saved.validation && validation?.restore) validation.restore(saved.validation)
    if (saved.protection && protection?.restore) protection.restore(saved.protection)
    if (saved.condFormat && condFormat?.restore) condFormat.restore(saved.condFormat)
    if (saved.sortFilter && sortFilter?.restore) sortFilter.restore(saved.sortFilter)
    if (saved.slicers && slicers?.restore) slicers.restore(saved.slicers)
    if (saved.view && applyViewState) applyViewState(saved.view)
    if (saved.pivot && pivot?.restore) pivot.restore(saved.pivot)
    if (saved.charts && charts?.restore) charts.restore(saved.charts)
    if (saved.namedRanges && namedRanges?.restore) namedRanges.restore(saved.namedRanges)
    for (const [from, to] of renamed) {
      for (const store of [formats, ...sideStores]) store?.renameSheet?.(from, to)
    }
    if (saved.namedRanges && namedRanges?.restore) {
      // A name on a sheet the file no longer has (saved before ISSUES #77)
      // is #REF!, as if that sheet were deleted now: a sheet added later
      // under its name doesn't bring it back. Checked after a develop
      // sheet's renames; skipped when its conversion failed (IronCalc then
      // holds none of its sheets).
      const sheets = engine.client?.()?.sheets
      if (sheets && namedRanges.deleteSheet && converted?.ok !== false) {
        const have = new Set(sheets.map((s) => s.toLowerCase()))
        for (const e of namedRanges.list())
          if (e.sheet && !have.has(e.sheet.toLowerCase())) namedRanges.deleteSheet(e.sheet)
      }
      // IronCalc started before the names were back, and its saved names
      // can be out of date (one whose cells were deleted: ISSUES #74).
      engine.syncDefinedNames?.()
    } else if (converted?.ok) {
      // A formula naming a defined name shows #NAME? until IronCalc has the names.
      engine.syncDefinedNames?.()
    }
    legacyCurrent.value = plan?.current ?? null
  }

  // IronCalc's bytes carry no version of their own, and one IronCalc may not
  // read another's (0.9.0 cannot read 0.8.4's). When a body saved by another
  // version fails to open, say so instead of IronCalc's "bitcode error".
  async function _startEngine(saved) {
    try {
      await engine.start(saved.engine ? base64ToBytes(saved.engine) : null)
    } catch (err) {
      const version = saved.engine_version
      if (!saved.engine || !version || version === ENGINE_VERSION) throw err
      throw new Error(
        `This sheet was saved by IronCalc ${version}, which this Sheets (IronCalc ${ENGINE_VERSION}) cannot read. Reload the page; if it still does not open, report it.`,
        { cause: err },
      )
    }
  }

  // The saved per-sheet view under the converted sheet names. A legacy flat
  // view (one sheet's, no names) stays as it is.
  function _renameKeys(view, renamed) {
    if (typeof view !== 'object' || 'colW' in view || 'rowH' in view || 'freezeRows' in view)
      return view
    return Object.fromEntries(Object.entries(view).map(([k, v]) => [renamed[k] ?? k, v]))
  }

  // The whole workbook as the JSON `sheets_data` held. The surface keeps it
  // as the local recovery copy when access narrows. `draft` is a cell edit
  // still in progress ({ sheet, cell, value }); it is kept next to the
  // workbook, which is not changed.
  async function workbookJson(draft = null) {
    const bytes = await engine.toBytes()
    const snapshot = {
      engine: bytesToBase64(bytes),
      engine_version: ENGINE_VERSION,
      formats: formats.snapshot(),
      merge: merge?.snapshot?.() ?? null,
      comments: comments?.snapshot?.() ?? null,
      validation: validation?.snapshot?.() ?? null,
      protection: protection?.snapshot?.() ?? null,
      condFormat: condFormat?.snapshot?.() ?? null,
      sortFilter: sortFilter?.snapshot?.() ?? null,
      slicers: slicers?.snapshot?.() ?? null,
      pivot: pivot?.snapshot?.() ?? null,
      charts: charts?.snapshot?.() ?? null,
      namedRanges: namedRanges?.snapshot?.() ?? null,
      view: getViewState?.() ?? null,
    }
    if (draft) snapshot.draft = draft
    return JSON.stringify(snapshot)
  }
  return {
    loadError,
    legacyCurrent,
    loadSheet,
    loadBody,
    workbookJson,
  }
}
