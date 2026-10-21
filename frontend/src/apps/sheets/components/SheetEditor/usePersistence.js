import { ref } from 'vue'

import { api, client } from '@/api'

import { base64ToBytes, bytesToBase64, ENGINE_VERSION } from '../../core/snapshot-codec'
import {
  decodeFromDownload,
  encodeForUpload,
  isDecompressionSupported,
} from '../../utils/compress.js'
import { applyLegacyPlan, planLegacySheet, unknownFunctionCells } from '../../utils/legacy-sheet'
import { isRefusal } from '../../utils/relay.js'
import { recordVisit } from './driveVisit'

// `merge` and the view-state getters/setters are optional — they were missing
// from earlier versions and their absence caused merged cells / column widths /
// freeze panes / hidden cols/rows to silently disappear after every save.
//
// Access options, all optional:
//   - `isWritable()` — checked before every save attempt, retries included. While
//     it answers false a save sends nothing, so a pending save is cancelled.
//   - `onRefused()` — the server refused a save for lack of access.
//   - `recordVisits` — record a Drive visit when a linked sheet loads. The `/d/`
//     surface passes false: its Drive session records the visit itself.
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
  isWritable = () => true,
  onRefused = () => {},
  recordVisits = true,
  requestContext,
}) {
  const isSaving = ref(false)
  const saveError = ref('')
  // Write permission for the currently-loaded sheet, from get_sheet's `can_write`.
  // Defaults to true so a brand-new (autoCreate) doc — which the creator always
  // owns — never flashes read-only before the first load resolves.
  const canWrite = ref(true)
  // The sheet's true owner (creator's user id), surfaced by get_sheet so the
  // Share dialog can name the real owner rather than the current viewer. Empty
  // until the first load resolves; for a brand-new sheet the editor falls back
  // to the session user (who is the creator).
  const sheetOwner = ref('')
  // Surfaces "couldn't open this sheet" cases (404 / 403 / network) to the
  // editor so it can render a proper error screen instead of mounting a
  // blank canvas. Shape: { kind: 'denied' | 'missing' | 'other', message }.
  const loadError = ref(null)
  // Set when the loaded sheet was last saved by the develop editor and was
  // converted on open: { ok, save, current, renamed, skipped, unknown }. `save`
  // says the converted sheet will be saved (the caller may write); `unknown`
  // lists the formulas IronCalc shows as #NAME?. Null for any other sheet.
  const legacyUpgrade = ref(null)
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
  // Runs once before the next save is sent: keeps the develop body as a
  // Drive version. Cleared when it succeeds.
  let _beforeFirstSave = null
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
      // A sheet Drive owns has a node; a legacy sheet has none and no Recents row.
      if (recordVisits && doc.node) recordVisit(doc.node).catch(() => {})
      const plain = canGz ? await decodeFromDownload(doc.sheets_data) : doc.sheets_data
      const saved = JSON.parse(plain || '{}')
      const mayWrite = doc.can_write !== false
      if (saved.formats) formats.restore(saved.formats)
      await _startEngine(saved)
      // A sheet last saved by the develop editor: its cells are typed into
      // IronCalc here (utils/legacy-sheet.ts); the side stores below restore
      // from its old shapes as they are.
      const plan = saved.engine ? null : planLegacySheet(saved.sheet)
      const converted = plan ? await applyLegacyPlan(engine.client(), plan) : null
      const renamed = converted?.ok ? Object.entries(plan.renamed) : []
      if (renamed.length && saved.view) saved.view = _renameKeys(saved.view, plan.renamed)
      if (saved.merge && merge?.restore) merge.restore(saved.merge)
      // Drive owns a develop sheet's comments: the migration made them Drive
      // threads and stripped them from the body. A develop body that still has
      // them is an old version restored; restoring them would show each twice.
      const commentsInDrive = plan && doc.node
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
      legacyUpgrade.value = plan ? await _legacyUpgrade(plan, converted, mayWrite) : null
      // Before the first save of a converted sheet, Drive keeps the develop
      // body as a version to go back to.
      _beforeFirstSave =
        legacyUpgrade.value?.save && doc.node ? () => _keepBeforeUpgrade(doc.node) : null
      currentTitle.value = doc.title
      // Older backends predate `can_write`; treat its absence as writable so we
      // never lock out an editor on a stale server. A develop sheet IronCalc
      // could not take opens read-only, so no save replaces its old body.
      canWrite.value = mayWrite && converted?.ok !== false
      sheetOwner.value = doc.owner || ''
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
    }
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

  async function _legacyUpgrade(plan, converted, mayWrite) {
    const upgrade = {
      ok: converted.ok,
      save: converted.ok && mayWrite,
      current: plan.current,
      renamed: plan.renamed,
      skipped: plan.skipped,
      unknown: [],
    }
    if (!converted.ok) {
      console.error('[sheets] could not convert a develop sheet:', converted.error)
      return upgrade
    }
    // A formula naming a defined name shows #NAME? until IronCalc has the names.
    engine.syncDefinedNames?.()
    try {
      upgrade.unknown = await unknownFunctionCells(engine.client(), plan.formulas)
    } catch (err) {
      console.error('[sheets] could not check converted formulas:', err)
    }
    return upgrade
  }

  function _keepBeforeUpgrade(node) {
    return client.mutation(
      api.drive.versions.create,
      { node, kind: 'named', label: 'Before upgrade' },
      { context: requestContext, silent: true },
    )
  }

  // The saved per-sheet view under the converted sheet names. A legacy flat
  // view (one sheet's, no names) stays as it is.
  function _renameKeys(view, renamed) {
    if (typeof view !== 'object' || 'colW' in view || 'rowH' in view || 'freezeRows' in view)
      return view
    return Object.fromEntries(Object.entries(view).map(([k, v]) => [renamed[k] ?? k, v]))
  }

  // Creates a brand-new doc on the backend with the given title and returns the
  // doc name.  Called immediately on mount so every doc has a real ID from the
  // start — no manual-save step, matching Google Sheets' always-saved model.
  async function autoCreate(title, { ops } = {}) {
    return _persist(null, title || 'Untitled Sheet', {
      ops,
    })
  }
  async function saveExisting(name, title, { keepalive = false, ops } = {}) {
    return _persist(name, title, {
      keepalive,
      ops,
    })
  }

  // Transient → retry with backoff. Permanent → fail fast so the user
  // gets an honest error instead of waiting ~7 s for three retries that
  // were never going to succeed.
  //
  // The Frappe api helper attaches `excType` + `status` to thrown errors
  // (see utils/api.js), so we don't have to regex the message.
  function _isTransientSaveError(err) {
    // No status → fetch itself threw (offline, DNS failure, server killed
    // mid-flight before the response existed). Always retry these.
    if (err?.type === 'NetworkError') return true
    if (err?.status == null) return false
    // Server-side hiccups (502 Bad Gateway during deploy, 503 overloaded,
    // 504 timeout) — usually clear on the next attempt.
    if (err.status >= 500 && err.status <= 599) return true
    // 408 Request Timeout, 429 rate-limited — explicit "try again" codes.
    if (err.status === 408 || err.status === 429) return true
    // 4xx (permission, validation, CSRF, not-found, …) won't change by
    // re-sending the same payload. Surface immediately.
    return false
  }

  // Lets the user (and a watchdog inside the editor) explicitly re-run
  // the most recent failed save without having to make another edit to
  // re-trigger the auto-save timer. Populated by _persist at the start
  // of every attempt; cleared on success.
  let _lastSaveArgs = null
  async function retrySave() {
    if (!_lastSaveArgs) return null
    const { args, keepalive } = _lastSaveArgs
    return _send(args, keepalive)
  }
  async function _persist(name, title, { keepalive = false, ops } = {}) {
    isSaving.value = true
    // Build the payload ONCE up-front. If we rebuilt on each retry the
    // snapshots could pick up mid-edit state that arrived between
    // attempts, racing with the user's keystrokes.
    let args
    try {
      const sheetsData = _workbookJson(await engine.toBytes())
      const payload = await encodeForUpload(sheetsData)
      args = {
        title,
        sheets_data: payload,
        request_id: crypto.randomUUID(),
        ...(name
          ? {
              name,
            }
          : {}),
        ...(ops && ops.length
          ? {
              ops: JSON.stringify(ops),
            }
          : {}),
      }
    } catch (err) {
      isSaving.value = false
      saveError.value = err.message || "Couldn't prepare save payload."
      throw err
    }
    _lastSaveArgs = {
      args,
      keepalive,
    }
    return _send(args, keepalive)
  }

  // The whole workbook as the JSON `sheets_data` stores. The surface keeps it
  // as the local recovery copy when access narrows. `draft` is a cell edit
  // still in progress ({ sheet, cell, value }); it is kept next to the
  // workbook, which is not changed.
  async function workbookJson(draft = null) {
    return _workbookJson(await engine.toBytes(), draft)
  }
  function _workbookJson(bytes, draft = null) {
    return JSON.stringify({
      engine: bytesToBase64(bytes),
      engine_version: ENGINE_VERSION,
      ...(draft ? { draft } : {}),
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
    })
  }
  async function _send(args, keepalive) {
    isSaving.value = true
    // keepalive saves fire from onBeforeUnmount — the browser may kill
    // the page before any backoff finishes, so don't retry them.
    const backoffMs = keepalive ? [0] : [0, 1000, 2500]
    let lastErr = null
    try {
      for (let attempt = 0; attempt < backoffMs.length; attempt++) {
        if (backoffMs[attempt] > 0) {
          await new Promise((r) => setTimeout(r, backoffMs[attempt]))
        }
        if (!isWritable()) {
          saveError.value = 'Not saved: you can no longer edit this sheet.'
          throw new DOMException('Editing access changed', 'AbortError')
        }
        if (_beforeFirstSave) {
          try {
            await _beforeFirstSave()
          } catch (err) {
            saveError.value = `Not saved: couldn't keep the "Before upgrade" version (${err?.message || 'unknown error'}).`
            throw err
          }
          _beforeFirstSave = null
        }
        try {
          const result = await client.mutation(api.sheets.documents.save, args, {
            keepalive,
            context: requestContext,
            silent: true,
          })
          // Deliberately DON'T write `title` back into currentTitle here.
          // `title` is a snapshot captured when this save was queued (up to
          // the 2s debounce + network round-trip ago), and the server echoes
          // nothing new — so assigning it back can only clobber keystrokes the
          // user typed while the save was in flight and reset their caret to
          // the end (the "jittery title" bug). currentTitle is already the
          // local source of truth; leave it alone.
          // First success clears any sticky error from a previous failure.
          saveError.value = ''
          _lastSaveArgs = null
          return result.name
        } catch (err) {
          lastErr = err
          if (isRefusal(err)) onRefused()
          if (!_isTransientSaveError(err)) break
        }
      }
      // All attempts exhausted (or hit a permanent error). The chip
      // stays visible until the next successful save — no auto-clear,
      // because silently hiding "your work isn't saved" is the worst
      // possible UX for an editor.
      saveError.value = lastErr?.message
        ? `Couldn't save: ${lastErr.message}`
        : "Couldn't save — check your connection, then click retry."
      throw lastErr || new Error(saveError.value)
    } finally {
      isSaving.value = false
    }
  }
  return {
    isSaving,
    saveError,
    canWrite,
    sheetOwner,
    loadError,
    legacyUpgrade,
    loadSheet,
    autoCreate,
    saveExisting,
    retrySave,
    workbookJson,
  }
}
