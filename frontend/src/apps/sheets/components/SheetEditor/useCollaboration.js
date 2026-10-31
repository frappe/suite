import { onUnmounted, ref, watch } from 'vue'

import {
  getSessionUser,
  fullName as sessionFullName,
  imageURL as sessionImageURL,
} from '@/boot/session'

import { createAwareness } from '../../collab/awareness.js'
import { bindCells } from '../../collab/cells-binding.js'
import { createFrappeProvider } from '../../collab/frappe-provider.js'
import { ensureFrappeRealtime } from '../../collab/frappe-realtime-init.js'
import { createRealtimeAdapter } from '../../collab/realtime-adapter.js'
import { createYDoc, hydrateYDoc } from '../../collab/ydoc.js'
import { isRefusal, relay } from '../../utils/relay.js'
import { userInitials } from '../../utils/session.js'

// Collaboration cursor palette — 8 distinct colours not covered by Espresso tokens.
const CURSOR_PALETTE = [
  '#4285F4',
  '#EA4335',
  '#34A853',
  '#FBBC05',
  '#AB47BC',
  '#00ACC1',
  '#FF7043',
  '#8D6E63',
]

function hashUserColor(user) {
  let hash = 0
  for (const char of user || '') hash = (hash * 31 + char.charCodeAt(0)) & 0xffffffff
  return CURSOR_PALETTE[Math.abs(hash) % CURSOR_PALETTE.length]
}

// First name (or initials if the full name only has one word) — what
// Google Sheets paints as the cursor label. We prefer first names because
// they read at a glance and aren't redundant with the avatar's initials.
function _firstName(fullName, initials) {
  const first = String(fullName || '')
    .trim()
    .split(/\s+/)[0]
  return first || initials || '?'
}

// Throttle cursor broadcasts so a drag-selection across 30 cells doesn't
// emit 30 awareness frames. 60ms ≈ one frame; leading-edge means the
// first move is instant, trailing-edge means the final resting position
// is guaranteed to publish.
const CURSOR_BROADCAST_MS = 60

function _throttle(fn, wait) {
  let last = 0
  let timer = null
  let pending = null
  function flush() {
    last = Date.now()
    timer = null
    if (pending) {
      fn(...pending)
      pending = null
    }
  }
  return function (...args) {
    const now = Date.now()
    const remaining = wait - (now - last)
    pending = args
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      flush()
    } else if (!timer) {
      timer = setTimeout(flush, remaining)
    }
  }
}

/**
 * Unified collaboration composable powered by a Yjs document per sheet.
 *
 *   * Cell edits are mirrored via a Y.Map binding so concurrent writes
 *     converge automatically — no more last-write-wins data loss.
 *   * Presence and cursor positions live in Yjs awareness — one volatile
 *     channel shared with the same transport.
 *   * The previous bespoke `broadcast_op` / `sheet_cursor` / `ping_presence`
 *     flow is retired; the backend endpoints still exist but are no longer
 *     called from the editor.
 *
 * The external API (`presentUsers`, `remoteCursors`, `broadcastCellChange`,
 * `broadcastBatchChange`, `broadcastCursor`) is preserved so index.vue
 * doesn't need to change — the broadcast functions are now no-ops for cells
 * (the patched `sheet.setCell` from `bindCells` handles publishing) and
 * thin awareness setters for the cursor.
 *
 * @param {{
 *   sheetId:        import('vue').Ref<string>,
 *   currentSheet:   import('vue').Ref<string>,
 *   getSheet?:      () => object | null,  the engine cell sync binds to; none
 *                   means presence and cursors only
 *   repopulateGrid: () => void,
 *   _self?:         string,
 *   _realtime?:     { on: Function, off: Function },
 *   _watch?:        typeof watch,
 *   _onUnmounted?:  typeof onUnmounted,
 * }} opts
 */
export function useCollaboration({
  sheetId,
  currentSheet,
  getSheet,
  repopulateGrid,
  // A collaboration verdict: the relay refused this client's write. The
  // editor narrows access.
  onRefused = () => {},
  // Send relay calls through this fetch. The `/d/` surface passes the Drive
  // session's, which adds its link credentials.
  credentialFetch,
  _self = getSessionUser(),
  _realtime = window.frappe?.realtime,
  _callFn = (method, args) => relay(method, args, { fetch: credentialFetch }),
  _watch = watch,
  _onUnmounted = onUnmounted,
}) {
  const _relay = async (method, args) => {
    try {
      return await _callFn(method, args)
    } catch (err) {
      if (isRefusal(err)) onRefused()
      throw err
    }
  }

  const presentUsers = ref([]) // other users currently viewing
  const remoteCursors = ref(new Map()) // userId → { row, col, subSheet, color, ... }

  let _doc = null
  let _provider = null
  let _awareness = null
  let _binding = null
  let _adapter = null // legacy relay only: holds the sheet-room subscription
  let _sheetId = null

  // ── Outbound API (kept for backwards-compatibility with index.vue) ──────────

  function broadcastCellChange(/* subSheet, id, value */) {
    // No-op: local writes are mirrored to the Y.Doc by bindCells's patched
    // sheet.setCell, then republished by the Frappe provider. Keeping this
    // function so index.vue's call sites compile without edits.
  }

  function broadcastBatchChange(/* subSheet, cellChanges */) {
    // Same reasoning as broadcastCellChange.
  }

  // Raw, un-throttled write to awareness. Wrapped below for the public API.
  function _publishCursor(row, col, subSheet, range) {
    if (!_awareness) return
    _awareness.setLocalState({ cursor: { row, col, range, subSheet } })
  }

  const _publishCursorThrottled = _throttle(_publishCursor, CURSOR_BROADCAST_MS)

  function broadcastCursor(row, col, subSheet, range = null) {
    // `range` is the full selection rectangle ({r0,c0,r1,c1}); peers paint
    // it as the "where this user is selected" outline. If absent (e.g.
    // legacy callers), the remote painter falls back to a single-cell rect
    // at the anchor.
    _publishCursorThrottled(row, col, subSheet, range)
  }

  // ── Awareness → reactive refs ───────────────────────────────────────────────

  function _syncFromAwareness() {
    if (!_awareness) return
    const peers = _awareness.getStates() // already excludes our clientId
    const users = []
    const cursors = new Map()
    const seen = new Set() // dedupe presence by user id

    for (const state of peers.values()) {
      const user = state?.user
      if (!user || !user.id || user.id === _self) continue
      const color = hashUserColor(user.id)
      const subSheet = state?.cursor?.subSheet || null
      if (!seen.has(user.id)) {
        seen.add(user.id)
        users.push({
          user: user.id,
          full_name: user.fullName,
          first_name: _firstName(user.fullName, user.initials),
          initials: user.initials,
          user_image: user.image,
          color,
          // Sub-sheet the peer is currently looking at. Lets the topbar
          // avatar pile show a small "on Sheet2" badge and powers the
          // per-tab dot indicators.
          sub_sheet: subSheet,
        })
      }
      if (state.cursor) {
        // Fallback range = single anchor cell (back-compat with peers that
        // haven't upgraded to the range-aware payload yet).
        const c = state.cursor
        const range = c.range || { r0: c.row, c0: c.col, r1: c.row, c1: c.col }
        cursors.set(user.id, {
          row: c.row,
          col: c.col,
          range,
          subSheet: c.subSheet,
          color,
          fullName: user.fullName,
          firstName: _firstName(user.fullName, user.initials),
          initials: user.initials,
        })
      }
    }
    presentUsers.value = users
    remoteCursors.value = cursors
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  function _start(docId) {
    if (_doc) _stop()
    _sheetId = docId

    // Cell sync patches a sheet engine's setCell. IronCalc has none to patch,
    // so until collaboration moves to it, only presence and cursors run.
    const sheet = getSheet?.() ?? null
    const identity = _readUserIdentity()

    // 1. Fresh Y.Doc. Every client seeds it locally from the engine snapshot
    //    (below, once the binding is in place); late peers overwrite us via
    //    the state-sync handshake.
    _doc = createYDoc()

    // 2. Patch sheet.setCell so every write also lands in Y.Map; observe
    //    remote writes and apply them through the engine. Cross-sheet
    //    remote writes still need a full canvas repopulate because the
    //    engine's onCellChanged callback paints to the active grid only.
    _binding = sheet
      ? bindCells({
          doc: _doc,
          sheet,
          getCurrentSheet: () => currentSheet.value,
          onRemoteSheetChange(name) {
            if (name !== currentSheet.value) repopulateGrid()
          },
        })
      : null

    hydrateYDoc(_doc, { sheet: sheet?.snapshot?.() })

    // 3. Relay through frappe.realtime. The www/sheets page doesn't load
    //    Frappe's socketio_client, so `window.frappe.realtime` is undefined
    //    and there would be no transport. ensureFrappeRealtime stands up a
    //    minimal shim against the site's socketio namespace on first use;
    //    no-op when a real client already exists (Desk-embedded paths, tests
    //    injecting `_realtime`).
    if (!_realtime || typeof _realtime.on !== 'function') {
      _realtime = ensureFrappeRealtime() || _realtime
    }
    const adapter = (_adapter = createRealtimeAdapter({
      sheetId: _sheetId,
      realtime: _realtime,
      callFn: _relay,
    }))
    _provider = createFrappeProvider({ doc: _doc, sheetId: _sheetId, realtime: adapter })
    _awareness = createAwareness({
      sheetId: _sheetId,
      realtime: adapter,
      clientId: _provider.tag,
      initial: { user: identity, cursor: null },
    })
    _awareness.on('change', _syncFromAwareness)
    _syncFromAwareness()
  }

  function _stop() {
    _binding?.dispose()
    _awareness?.destroy()
    _provider?.destroy()
    _adapter?.close()
    _doc?.destroy()
    _binding = _awareness = _provider = _adapter = _doc = null
    _sheetId = null
    presentUsers.value = []
    remoteCursors.value = new Map()
  }

  function _readUserIdentity() {
    // This only ever describes THIS client's own presence (id === _self, the
    // local user), so the name/image come straight from the shared suite
    // session profile — no need to re-derive "is this me", which meant a
    // second getSessionUser() read that could drift from the _self captured
    // at init (e.g. after a re-login).
    const id = _self
    const fullName = sessionFullName.value || id || 'Anonymous'
    return {
      id,
      fullName: String(fullName),
      initials: userInitials(sessionFullName.value, id),
      image: sessionImageURL.value || '',
    }
  }

  _watch(
    sheetId,
    (docId) => {
      if (docId && docId !== 'new') _start(docId)
      else _stop()
    },
    { immediate: true },
  )

  _onUnmounted(_stop)

  // Conflict-aware undo support — index.vue's history pulls this between
  // pushes to remember which cells *this* client touched in each undo
  // segment. When collab is off (no binding), there's nothing to drain so
  // we return an empty set and undo falls back to the snapshot restore.
  function drainLocalTouches() {
    return _binding?.drainLocalTouches?.() || new Set()
  }

  return {
    presentUsers,
    remoteCursors,
    broadcastCellChange,
    broadcastBatchChange,
    broadcastCursor,
    drainLocalTouches,
  }
}
