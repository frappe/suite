import { ref } from 'vue'
import { call }                  from '../../utils/api.js'
import { encodeForUpload, isDecompressionSupported, decodeFromDownload } from '../../utils/compress.js'
import { packSheet, packSheetChunked, unpackSheet, boundsOf } from '../../utils/sheet-codec.js'

// `merge` and the view-state getters/setters are optional — they were missing
// from earlier versions and their absence caused merged cells / column widths /
// freeze panes / hidden cols/rows to silently disappear after every save.
export function usePersistence({ sheet, formats, merge, comments, validation, condFormat, sortFilter, pivot, charts, namedRanges, getViewState, applyViewState, currentTitle, emit }) {
  const isSaving  = ref(false)
  const saveError = ref('')
  // Surfaces "couldn't open this sheet" cases (404 / 403 / network) to the
  // editor so it can render a proper error screen instead of mounting a
  // blank canvas. Shape: { kind: 'denied' | 'missing' | 'other', message }.
  const loadError = ref(null)

  async function loadSheet(name) {
    loadError.value = null
    try {
      const canGz  = isDecompressionSupported()
      const doc    = await call('suite.sheets.api.get_sheet', { name, compressed: canGz ? 1 : 0 })
      const plain  = canGz ? await decodeFromDownload(doc.sheets_data) : doc.sheets_data
      const saved  = JSON.parse(plain || '{}')
      if (saved.formats)    formats.restore(saved.formats)
      sheet.restore(
        unpackSheet(saved.sheet) ?? { sheets: { Sheet1: {} }, current: 'Sheet1' },
        boundsOf(saved.sheet),
      )
      if (saved.merge      && merge?.restore)      merge.restore(saved.merge)
      if (saved.comments   && comments?.restore)   comments.restore(saved.comments)
      if (saved.validation && validation?.restore) validation.restore(saved.validation)
      if (saved.condFormat && condFormat?.restore) condFormat.restore(saved.condFormat)
      if (saved.sortFilter && sortFilter?.restore) sortFilter.restore(saved.sortFilter)
      if (saved.view       && applyViewState)      applyViewState(saved.view)
      if (saved.pivot      && pivot?.restore)      pivot.restore(saved.pivot)
      if (saved.charts     && charts?.restore)     charts.restore(saved.charts)
      if (saved.namedRanges && namedRanges?.restore) namedRanges.restore(saved.namedRanges)
      currentTitle.value = doc.title
    } catch (err) {
      console.error('Load failed:', err)
      const t = err?.excType || ''
      const kind =
        t === 'PermissionError'    ? 'denied'  :
        t === 'DoesNotExistError'  ? 'missing' :
                                     'other'
      loadError.value = { kind, message: err?.message || 'Could not open this sheet' }
    }
  }

  // Creates a brand-new doc on the backend with the given title and returns the
  // doc name.  Called immediately on mount so every doc has a real ID from the
  // start — no manual-save step, matching Google Sheets' always-saved model.
  async function autoCreate(title, { ops } = {}) {
    return _persist(null, title || 'Untitled Sheet', { ops })
  }

  async function saveExisting(name, title, { keepalive = false, ops } = {}) {
    return _persist(name, title, { keepalive, ops })
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
    if (err?.status == null) return true
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
    const { name, title, opts } = _lastSaveArgs
    return _persist(name, title, opts)
  }

  async function _persist(name, title, { keepalive = false, ops } = {}) {
    _lastSaveArgs = { name, title, opts: { keepalive, ops } }
    isSaving.value = true
    // Build the payload ONCE up-front. If we rebuilt on each retry the
    // snapshots could pick up mid-edit state that arrived between
    // attempts, racing with the user's keystrokes.
    let args
    try {
      // Pack straight from live cell data — the packer builds a fresh compact
      // structure, so it's an independent payload without snapshot()'s
      // deepClone. The chunked packer yields to the event loop so a 2M-cell
      // pack doesn't block input for seconds; the keepalive/unmount save can't
      // afford to yield (the page may die first), so it packs synchronously.
      const live   = { sheets: sheet.getAllRaw(), current: sheet.getCurrentSheet() }
      const packed = keepalive ? packSheet(live) : await packSheetChunked(live)
      const sheetsData = JSON.stringify({
        sheet:      packed,
        formats:    formats.snapshot(),
        merge:      merge?.snapshot?.()      ?? null,
        comments:   comments?.snapshot?.()   ?? null,
        validation: validation?.snapshot?.() ?? null,
        condFormat: condFormat?.snapshot?.() ?? null,
        sortFilter: sortFilter?.snapshot?.() ?? null,
        pivot:      pivot?.snapshot?.()      ?? null,
        charts:     charts?.snapshot?.()     ?? null,
        namedRanges: namedRanges?.snapshot?.() ?? null,
        view:       getViewState?.()         ?? null,
      })
      const payload = await encodeForUpload(sheetsData)
      args = {
        title,
        sheets_data: payload,
        ...(name ? { name } : {}),
        ...(ops && ops.length ? { ops: JSON.stringify(ops) } : {}),
      }
    } catch (err) {
      isSaving.value = false
      saveError.value = err.message || "Couldn't prepare save payload."
      return null
    }

    // keepalive saves fire from onBeforeUnmount — the browser may kill
    // the page before any backoff finishes, so don't retry them.
    const backoffMs = keepalive ? [0] : [0, 1000, 2500]
    let lastErr = null
    try {
      for (let attempt = 0; attempt < backoffMs.length; attempt++) {
        if (backoffMs[attempt] > 0) {
          await new Promise(r => setTimeout(r, backoffMs[attempt]))
        }
        try {
          const result = await call('suite.sheets.api.save_sheet', args, { keepalive })
          currentTitle.value = title
          // First success clears any sticky error from a previous failure.
          saveError.value = ''
          _lastSaveArgs   = null
          return typeof result === 'string' ? result : result?.name
        } catch (err) {
          lastErr = err
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
      return null
    } finally {
      isSaving.value = false
    }
  }

  return { isSaving, saveError, loadError, loadSheet, autoCreate, saveExisting, retrySave }
}
