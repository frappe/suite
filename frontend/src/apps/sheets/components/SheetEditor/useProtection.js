// Protected ranges and sheets: the write guards every user edit consults, and
// the protect / unprotect menu actions. Extracted from SheetEditor/index.vue.
//
// Usage:
//   const { protectionNotice, rectBlocked, cellBlocked, ... } = useProtection({
//     protection, currentSheet, contextMenu, tabMenu, history, getGrid, markDirty })

import { ref } from 'vue'

import { parseCellId } from '../../utils/cells.js'

export function useProtection({
  protection,
  currentSheet,
  contextMenu,
  tabMenu,
  history,
  getGrid,
  markDirty,
}) {
  // ── Protection enforcement ────────────────────────────────────────────────────
  // The single gate every user-initiated write consults. Each helper returns true
  // — and flashes a transient notice — when the target is protected, so callers
  // bail with `if (…) return`. Programmatic paths (undo/restore/collab) never call
  // these, so they can still rewrite protected cells.
  //
  // A dedicated notice ref — NOT saveError — so a "protected" message renders as a
  // neutral badge and doesn't arm the save-error watchdog / retry affordance.
  const protectionNotice = ref('')
  function flashProtected(sn) {
    const msg = protection.isSheetLocked(sn)
      ? 'This sheet is protected'
      : 'This range is protected and can’t be edited'
    protectionNotice.value = msg
    setTimeout(() => {
      if (protectionNotice.value === msg) protectionNotice.value = ''
    }, 3500)
  }
  function rectBlocked(rect, sn = currentSheet.value) {
    if (!rect || !protection.isAnyProtected(rect, sn)) return false
    flashProtected(sn)
    return true
  }
  function cellBlocked(id, sn = currentSheet.value) {
    const p = parseCellId(id)
    if (!p || !protection.isProtected(p.row, p.col, sn)) return false
    flashProtected(sn)
    return true
  }
  function cellsBlocked(ids, sn = currentSheet.value) {
    const hit = ids.some((id) => cellSilentlyProtected(id, sn))
    if (hit) flashProtected(sn)
    return hit
  }
  function cellSilentlyProtected(id, sn = currentSheet.value) {
    const p = parseCellId(id)
    return !!(p && protection.isProtected(p.row, p.col, sn))
  }
  // A fill writes only the destination — the strip(s) of `total` outside `src`.
  // Checking the whole extent would wrongly block a fill that merely *starts*
  // from a protected cell (reading a protected source is fine; only writes are
  // guarded). A fill extends in one direction, so at most one strip is non-empty.
  function fillDestBlocked(src, total, sn = currentSheet.value) {
    const strips = []
    if (total.r1 > src.r1)
      strips.push({
        r0: src.r1 + 1,
        r1: total.r1,
        c0: total.c0,
        c1: total.c1,
      })
    if (total.r0 < src.r0)
      strips.push({
        r0: total.r0,
        r1: src.r0 - 1,
        c0: total.c0,
        c1: total.c1,
      })
    if (total.c1 > src.c1)
      strips.push({
        r0: total.r0,
        r1: total.r1,
        c0: src.c1 + 1,
        c1: total.c1,
      })
    if (total.c0 < src.c0)
      strips.push({
        r0: total.r0,
        r1: total.r1,
        c0: total.c0,
        c1: src.c0 - 1,
      })
    if (!strips.some((s) => protection.isAnyProtected(s, sn))) return false
    flashProtected(sn)
    return true
  }

  // ── Protection UI actions ─────────────────────────────────────────────────────
  function protectSelection() {
    contextMenu.open = false
    const sel = getGrid()?.getSelection?.()
    if (!sel) return
    protection.addRange(sel, '', currentSheet.value)
    history.push()
    markDirty()
    getGrid()?.render?.()
  }
  function unprotectSelection() {
    contextMenu.open = false
    const sel = getGrid()?.getSelection?.()
    if (!sel) return
    const sn = currentSheet.value
    // Drop every protected range that overlaps the selection.
    for (const r of [...protection.getRanges(sn)]) {
      if (sel.r0 <= r.r1 && sel.r1 >= r.r0 && sel.c0 <= r.c1 && sel.c1 >= r.c0) {
        protection.removeRange(r.id, sn)
      }
    }
    history.push()
    markDirty()
    getGrid()?.render?.()
  }
  function toggleSheetProtection(name) {
    tabMenu.open = false
    protection.setSheetLocked(!protection.isSheetLocked(name), name)
    history.push()
    markDirty()
    getGrid()?.render?.()
  }
  // Menu-label reads. These are plain functions (not computed) so the template
  // re-evaluates them against the live selection each time the menu re-renders —
  // a computed would cache a stale answer when neither dep happened to change.
  // selectionHasProtectedRange looks only at ranges: the whole-sheet lock is a
  // separate affordance in the tab menu, so "Remove protection" here never lies
  // about a lock it can't clear.
  function selectionHasProtectedRange() {
    const sel = getGrid()?.getSelection?.()
    if (!sel) return false
    const sn = currentSheet.value
    return protection
      .getRanges(sn)
      .some((r) => sel.r0 <= r.r1 && sel.r1 >= r.r0 && sel.c0 <= r.c1 && sel.c1 >= r.c0)
  }
  function tabMenuSheetLocked() {
    return !!tabMenu.name && protection.isSheetLocked(tabMenu.name)
  }

  return {
    protectionNotice,
    flashProtected,
    rectBlocked,
    cellBlocked,
    cellsBlocked,
    cellSilentlyProtected,
    fillDestBlocked,
    protectSelection,
    unprotectSelection,
    toggleSheetProtection,
    selectionHasProtectedRange,
    tabMenuSheetLocked,
  }
}
