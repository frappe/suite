import { onScopeDispose, ref } from 'vue'

import { api, client } from '@/api'
import { useRootStore } from '@/stores/root'

import { cellId } from '../../utils/cells.js'

// AI Assist, extracted from SheetEditor/index.vue: the Ask bar state, asking
// the backend, applying its plan as one undoable op, Keep / Undo, and the AI
// settings entry in the command palette.
//
// The editor passes its helpers under their own names; the `_names` are kept
// here so the code reads as it did in index.vue.
export function useAiAssist({
  getGrid,
  getDocName,
  currentSheet,
  history,
  isDirty,
  syncFlags,
  undo,
  refreshActiveFormat,
  readRect,
  readIds: _readIds,
  writeInputs: _writeInputs,
  cellSilentlyProtected: _cellSilentlyProtected,
  flashProtected: _flashProtected,
  refitRowsFor,
}) {
  //
  // One primitive: select → ask in plain words → see it applied → Keep or Undo.
  // The backend returns a validated action plan; the model emits formulas, the
  // engine computes. Applying ends in one pushOp, as fill/paste do, so it is
  // one commit to the room and a single Undo reverts the whole batch.

  const aiEnabled = ref(!!window.frappe?.boot?.ai_assist_enabled)
  const askOpen = ref(false)
  const askBusy = ref(false)
  const askError = ref('')
  const askAnswer = ref('')
  const aiPending = ref(null) // null | { count }
  const askSelectionLabel = ref('')

  // After saving AI settings, refresh the boot flag + reactive ref in-place so
  // the "Ask" entry point appears/disappears without a full reload.
  function onAiSettingsSaved(s) {
    // The keyless "mock"/"demo" model counts as configured too.
    const isMock = ['mock', 'demo'].includes(
      String(s?.model || '')
        .trim()
        .toLowerCase(),
    )
    const on = !!(s?.enabled && (s?.keyIsSet || isMock))
    if (window.frappe?.boot) window.frappe.boot.ai_assist_enabled = on
    aiEnabled.value = on
  }
  function openAskBar() {
    askError.value = ''
    askAnswer.value = ''
    aiPending.value = null
    askSelectionLabel.value = getGrid()?.getActiveCell?.() || ''
    askOpen.value = true
  }
  function closeAskBar() {
    // Closing with a pending change is an implicit Keep — it's already applied
    // and queued.
    askOpen.value = false
    askError.value = ''
    askAnswer.value = ''
    aiPending.value = null
  }
  // The context the server builds for the model is the sheet as this editor
  // shows it: the live room holds the sheet, and only the browser has formula
  // results. Its top-left block, one row and column past what the server
  // samples (25 rows, 40 columns: suite/sheets/ai/context.py), so it can say
  // the view is partial. Typed values keep the column types readable; a
  // formula sends its result.
  const CONTEXT_ROWS = 26
  const CONTEXT_COLS = 41
  async function _contextCells(sn) {
    const rect = { r0: 0, c0: 0, r1: CONTEXT_ROWS - 1, c1: CONTEXT_COLS - 1 }
    const { inputs, displays } = await readRect(sn, rect)
    const cells = {}
    inputs.forEach((row, r) =>
      row.forEach((input, c) => {
        const value = String(input ?? '').startsWith('=') ? displays[r]?.[c] : input
        if (value != null && value !== '') cells[cellId(r, c)] = String(value)
      }),
    )
    return cells
  }

  async function onAskSubmit(promptText) {
    askError.value = ''
    askAnswer.value = ''
    aiPending.value = null
    askBusy.value = true
    try {
      const sel = getGrid()?.getSelection?.() || {
        r0: 0,
        c0: 0,
        r1: 0,
        c1: 0,
      }
      const selection = JSON.stringify({
        sheet: currentSheet.value,
        r0: sel.r0,
        c0: sel.c0,
        r1: sel.r1,
        c1: sel.c1,
        active: getGrid()?.getActiveCell?.() || '',
      })
      const res = await client.query(api.sheets.assistant.ask, {
        name: getDocName(),
        prompt: promptText,
        selection,
        cells: JSON.stringify(await _contextCells(currentSheet.value)),
      })
      const actions = Array.isArray(res?.actions) ? res.actions : []
      const answers = actions.filter((a) => a.type === 'answer')
      if (answers.length) askAnswer.value = answers.map((a) => a.text).join('\n\n')
      const applied = await _applyAiActions(actions)
      if (applied > 0)
        aiPending.value = {
          count: applied,
        }
      else if (!answers.length) askAnswer.value = 'No changes suggested for that.'
    } catch (e) {
      askError.value = e && e.message ? String(e.message) : 'Something went wrong'
    } finally {
      askBusy.value = false
    }
  }

  // Apply setCell actions as ONE undoable op (mirrors the fill/paste path).
  // Returns the number of cells written.
  async function _applyAiActions(actions) {
    const sn = currentSheet.value
    let setCells = actions.filter((a) => a.type === 'setCell')
    // Drop writes that land on protected cells (rest still apply).
    const allowed = setCells.filter((a) => !_cellSilentlyProtected(a.cell, sn))
    if (allowed.length !== setCells.length) _flashProtected(sn)
    setCells = allowed
    if (!setCells.length) return 0
    const before = {}
    const after = {}
    Object.assign(
      before,
      await _readIds(
        setCells.map((a) => a.cell),
        sn,
      ),
    )
    for (const a of setCells) after[a.cell] = String(a.formula ?? '')
    _writeInputs(sn, after)
    const refs = setCells.map((a) => a.cell)
    // Rows with wrapped text refit to what the AI wrote, like a typed edit.
    const rowH = refitRowsFor?.(sn, after)

    // One undo step, like fill.
    history.pushOp({
      opType: 'ai_assist',
      subSheet: sn,
      cellRefs: refs,
      before,
      after,
      ...(rowH && { beforeRowH: rowH.before, afterRowH: rowH.after }),
    })
    getGrid()?.render()
    refreshActiveFormat()
    syncFlags()
    isDirty.value = true
    return refs.length
  }
  function onAskKeep() {
    // Already applied and saved; just dismiss and close.
    closeAskBar()
  }
  function onAskUndo() {
    // Reverts the whole batch in one step (single op).
    undo()
    aiPending.value = null
  }

  // AI settings in the command palette, for those allowed to configure it.
  const aiSettingsOpen = ref(false)
  const unregisterPaletteGroups = useRootStore().registerPaletteGroups(
    'sheets-editor-settings',
    () => {
      if (!window.frappe?.boot?.ai_assist_can_configure) return []
      return [
        {
          commands: [
            {
              id: 'sheets-settings',
              label: 'AI settings',
              icon: 'lucide-cpu',
              keywords: ['AI', 'assist', 'configure'],
              run: () => (aiSettingsOpen.value = true),
            },
          ],
        },
      ]
    },
  )
  onScopeDispose(unregisterPaletteGroups)

  return {
    aiEnabled,
    askOpen,
    askBusy,
    askError,
    askAnswer,
    aiPending,
    askSelectionLabel,
    aiSettingsOpen,
    onAiSettingsSaved,
    openAskBar,
    closeAskBar,
    onAskSubmit,
    onAskKeep,
    onAskUndo,
  }
}
