// The notes side panel: a global list of notes across all sheets, click to
// jump. Extracted from SheetEditor/index.vue. The panel itself is
// NotesPanel.vue; `allNotes` also feeds the topbar's notes badge.
//
// Usage:
//   const { notesPanel, allNotes, notesGrouped, toggleNotesPanel, jumpToNote } =
//     useNotesPanel({ comments, sheetNames, currentSheet, activeCell, getGrid,
//       switchSheet, openCommentPanel, onOpened })

import { computed, nextTick, reactive } from 'vue'

import { parseCellId } from '../../utils/cells.js'

export function useNotesPanel({
  comments,
  sheetNames,
  currentSheet,
  activeCell,
  getGrid,
  switchSheet,
  openCommentPanel,
  onOpened,
}) {
  // `rev` is bumped whenever a note is saved/deleted so the computed list
  // re-runs (the comments engine is plain state, not reactive).
  const notesPanel = reactive({
    open: false,
    rev: 0,
  })

  // All notes across all sheets, ordered: current sheet first, then by row/col.
  // Re-runs when notesPanel.rev bumps (after save/delete) — the comments engine
  // itself isn't reactive.
  const allNotes = computed(() => {
    void notesPanel.rev // dep for re-run
    const cur = currentSheet.value
    const list = []
    for (const name of sheetNames.value) {
      const map = comments.getAll(name) || {}
      const entries = Object.keys(map)
        .map((id) => ({
          id,
          p: parseCellId(id),
        }))
        .filter((e) => e.p)
        .sort((a, b) => a.p.row - b.p.row || a.p.col - b.p.col)
        .map((e) => ({
          sheet: name,
          id: e.id,
          text: comments.preview(e.id, name),
          resolved: !!comments.getThread(e.id, name)?.resolved,
        }))
      list.push(...entries)
    }
    list.sort((a, b) => {
      if (a.sheet === cur && b.sheet !== cur) return -1
      if (b.sheet === cur && a.sheet !== cur) return 1
      return a.sheet.localeCompare(b.sheet)
    })
    return list
  })
  const notesGrouped = computed(() => {
    const out = []
    let cur = null
    for (const n of allNotes.value) {
      if (!cur || cur.sheet !== n.sheet) {
        cur = {
          sheet: n.sheet,
          items: [],
        }
        out.push(cur)
      }
      cur.items.push(n)
    }
    return out
  })
  function toggleNotesPanel() {
    if (notesPanel.open) {
      notesPanel.open = false
      return
    }
    notesPanel.rev++ // force-refresh on open
    notesPanel.open = true
    onOpened()
  }
  function jumpToNote(n) {
    const grid = getGrid()
    if (!grid) return
    const p = parseCellId(n.id)
    if (!p) return
    if (n.sheet !== currentSheet.value) switchSheet(n.sheet)
    nextTick(() => {
      grid.moveTo(p.row, p.col)
      activeCell.value = n.id
      openCommentPanel()
    })
  }

  return { notesPanel, allNotes, notesGrouped, toggleNotesPanel, jumpToNote }
}
