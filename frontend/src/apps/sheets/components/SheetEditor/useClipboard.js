import { isCanvasClipboardTarget } from '../../utils/clipboard-target.js'

// Copy, cut and paste against the grid, extracted from SheetEditor/index.vue:
// the document copy/cut/paste listeners, Paste special, and the history entry
// a paste records. The clipboard engine (engine/clipboard.js) does the reading
// and writing; this decides when it may run and records the change.
//
// The editor passes its helpers under their own names; the `_names` are kept
// here so the code reads as it did in index.vue.
export function useClipboard({
  clipboard,
  getGrid,
  canvasRef,
  formulaInputRef,
  gridWrapRef,
  readOnly,
  currentSheet,
  activeCell,
  clipboardHas,
  contextMenu,
  condFormat,
  history,
  isDirty,
  syncFlags,
  rectBlocked: _rectBlocked,
  flashProtected: _flashProtected,
  showInput: _showInputInFormulaBar,
  readInputs: _readInputs,
  queueOp: _queueOp,
  pasteAffectedRects: _pasteAffectedRects,
  cutSourceElsewhere: _cutSourceElsewhere,
  captureFormatsRange: _captureFormatsRange,
  captureValidationRange: _captureValidationRange,
  diffRefs: _diffRefs,
  refitRowsFor,
}) {
  function _canvasActive() {
    return isCanvasClipboardTarget({
      activeEl: document.activeElement,
      canvasEl: canvasRef.value,
      formulaEl: formulaInputRef.value,
      gridWrap: gridWrapRef.value,
      editing: getGrid()?.isEditing?.() ?? false,
    })
  }

  // Returning to the tab or the sheet route leaves browser focus on <body>, not
  // the grid, so a Cmd+V fires a paste event the canvas never receives (onDocPaste
  // bails at the _canvasActive guard) — the "I have to click a cell first before
  // paste works" report. Pull focus back to the canvas, but ONLY when focus has
  // landed on nothing (body/null); never steal it from the formula bar, an inline
  // cell editor, or an open dialog.
  function _refocusGridIfIdle() {
    if (document.visibilityState === 'hidden') return
    const ae = document.activeElement
    if (ae && ae !== document.body) return
    canvasRef.value?.focus()
  }
  function onDocCopy(e) {
    if (!_canvasActive()) return
    e.preventDefault()
    const src = getGrid().getSelection()
    clipboard.copy(src).catch((err) => console.error('[sheets] copy failed', err))
    clipboardHas.value = true
    getGrid().setMarchingAnts(src)
  }
  function onDocCut(e) {
    if (!_canvasActive()) return
    if (readOnly.value) return // cut deletes cells — viewers may only copy

    e.preventDefault()
    const src = getGrid().getSelection()
    const sn = currentSheet.value
    // Cut moves content out of the source — block it when the source is protected.
    if (_rectBlocked(src, sn)) return
    // Nothing changes until the paste, which records the move for undo.
    clipboard.cut(src).catch((err) => console.error('[sheets] cut failed', err))
    clipboardHas.value = true
    getGrid().setMarchingAnts(src)
  }
  async function onDocPaste(e) {
    if (!_canvasActive()) return
    if (readOnly.value) return // viewers can't write pasted cells
    e.preventDefault()
    const destSel = getGrid().getSelection()
    const sn = currentSheet.value

    // Copied something else since (in another app, or a cell editor's
    // text)? Paste that, not the old copy.
    if (clipboard.isStale(e.clipboardData?.getData('text/plain'))) {
      clipboard.clear()
      clipboardHas.value = false
      getGrid().setMarchingAnts(null)
    }

    // Pasting a copied pivot mints a new live pivot at the anchor rather than
    // writing cells, so the op-based cell-diff undo below can't capture it (it
    // would leave the rendered cells without their _pivots registry entry).
    // Await the async render, then take one full history.push() snapshot, which
    // captures both the pivot registry and the written cells atomically.
    if (clipboard.hasData() && clipboard.getPivotBlob?.()) {
      if (_rectBlocked(destSel, sn)) return // a pivot paste bypasses the cell-write guard
      await clipboard.paste(activeCell.value, () => {}, 'all', destSel)
      clipboardHas.value = clipboard.hasData()
      getGrid().setMarchingAnts(null)
      _showInputInFormulaBar(activeCell.value) // fx bar tracks the pasted anchor
      history.push()
      isDirty.value = true
      return
    }

    // Prefer the HTML flavor when it carries a real table — external apps
    // (Gameplan, Google Sheets, web pages) put a structured <table> there, while
    // their text/plain flavor can lack tab delimiters and collapse into a single
    // column. Read both flavors up front so we can also MEASURE the paste extent
    // before writing (see below).
    const html = clipboard.hasData() ? null : e.clipboardData?.getData('text/html')
    const text = clipboard.hasData() ? null : e.clipboardData?.getData('text/plain')

    // For an external paste there is no internal source selection, so
    // _pasteAffectedRects only sees the clicked cell — the output block's real
    // size lives in the clipboard payload. Measure it (side-effect free, same
    // grid math the write uses) and fold it into the capture rect, or undo would
    // record only the anchor cell and leave the rest of the block behind.
    const externalRect = clipboard.hasData()
      ? null
      : (clipboard.measureHTMLPaste(html, activeCell.value, destSel) ??
        clipboard.measureTextPaste(text, activeCell.value, destSel))

    // Snapshot the pre-paste state for cells + formats + validation across
    // the destination rect, plus cond-format rule count for the fallback
    // decision. The cells+formats+validation diff drives op-based undo; if
    // the paste also added a cond-format rule, the rule list isn't part of
    // the op and we'd lose it on undo — fall back to a full snapshot in
    // that rarer case.
    // Capture across everything the paste can touch (dest, full output block,
    // and — for a cut — the vacated source) so undo restores all of it.
    const rects = _pasteAffectedRects(destSel)
    if (externalRect) rects.push(externalRect)
    const before = Object.assign({}, ...(await Promise.all(rects.map((r) => _readInputs(r, sn)))))
    const cutSrc = _cutSourceElsewhere(sn)
    const srcBefore = cutSrc && (await _readInputs(cutSrc.rect, cutSrc.sheet))
    const beforeFmt = Object.assign({}, ...rects.map((r) => _captureFormatsRange(r, sn)))
    const beforeVal = Object.assign({}, ...rects.map((r) => _captureValidationRange(r, sn)))
    const cfBefore = condFormat?.getRules?.(sn)?.length ?? 0
    let pasted = false
    if (clipboard.hasData()) {
      // Internal cut/copy — empty historyPush callback so we control the
      // history entry from out here. clipboard still does its mutations.
      // A protected destination returns { blocked } and writes nothing; leave
      // the marching ants + cut buffer intact so the user can retry elsewhere.
      if ((await clipboard.paste(activeCell.value, () => {}, 'all', destSel))?.blocked) {
        _flashProtected(sn)
        return
      }
      pasted = true
    } else {
      // Prefer a real HTML table; fall back to plain text. Either write into a
      // protected cell returns { blocked } and we bail without recording it.
      const htmlRes = html
        ? clipboard.pasteFromHTML(html, activeCell.value, () => {}, destSel)
        : false
      if (htmlRes?.blocked) {
        _flashProtected(sn)
        return
      }
      if (htmlRes) {
        pasted = true
      } else if (text) {
        if (clipboard.pasteFromText(text, activeCell.value, () => {}, destSel)?.blocked) {
          _flashProtected(sn)
          return
        }
        pasted = true
      }
    }
    clipboardHas.value = clipboard.hasData()
    getGrid().setMarchingAnts(null)
    if (pasted) {
      // Refresh display strings for every touched rect — the engine already
      // notified for cell-value changes, but format changes happened AFTER
      // batchSetCells so the canvas painted those cells with the old
      // format, and a cut's vacated source needs to repaint as empty.
      getGrid()?.render?.() // pasted formats
      // Reads wait for the paste's write, so `after` holds the pasted inputs.
      const after = Object.assign({}, ...(await Promise.all(rects.map((r) => _readInputs(r, sn)))))
      const source = cutSrc && {
        sheet: cutSrc.sheet,
        before: srcBefore,
        after: await _readInputs(cutSrc.rect, cutSrc.sheet),
      }
      _showInputInFormulaBar(activeCell.value) // fx bar tracks the pasted anchor
      const afterFmt = Object.assign({}, ...rects.map((r) => _captureFormatsRange(r, sn)))
      const afterVal = Object.assign({}, ...rects.map((r) => _captureValidationRange(r, sn)))
      const cfAfter = condFormat?.getRules?.(sn)?.length ?? 0
      const refs = _diffRefs(before, after)
      // Rows with wrapped text refit to the pasted values and formats (a cut's
      // vacated rows shrink back); the height change undoes with the paste.
      const rowH = refitRowsFor?.(sn, after)
      if (refs.length || cfBefore !== cfAfter) {
        _queueOp({
          opType: 'paste',
          subSheet: sn,
          cellRefs: refs,
          before,
          after,
          summary: `Pasted into ${refs.length} cell${refs.length === 1 ? '' : 's'}`,
          ...(source && { source }),
        })
        _pushPasteHistory({
          opType: 'paste',
          subSheet: sn,
          cellRefs: refs,
          before,
          after,
          beforeFormats: beforeFmt,
          afterFormats: afterFmt,
          beforeValidation: beforeVal,
          afterValidation: afterVal,
          cfChanged: cfBefore !== cfAfter,
          ...(source && { source }),
          ...(rowH && { beforeRowH: rowH.before, afterRowH: rowH.after }),
        })
        syncFlags()
      }
      isDirty.value = true
    }
  }

  // Right-click → Paste special. `kind` ∈ {'values', 'formats', 'formulas'}.
  async function doPasteSpecial(kind) {
    contextMenu.open = false
    if (!clipboard.hasData()) return
    const destSel = getGrid().getSelection()
    const sn = currentSheet.value
    const rects = _pasteAffectedRects(destSel)
    const before = Object.assign({}, ...(await Promise.all(rects.map((r) => _readInputs(r, sn)))))
    const cutSrc = _cutSourceElsewhere(sn)
    const srcBefore = cutSrc && (await _readInputs(cutSrc.rect, cutSrc.sheet))
    const beforeFmt = Object.assign({}, ...rects.map((r) => _captureFormatsRange(r, sn)))
    const beforeVal = Object.assign({}, ...rects.map((r) => _captureValidationRange(r, sn)))
    const cfBefore = condFormat?.getRules?.(sn)?.length ?? 0
    if ((await clipboard.paste(activeCell.value, () => {}, kind, destSel))?.blocked) {
      _flashProtected(sn)
      return // keep the pending cut/copy + its marching ants
    }
    getGrid()?.render?.() // pasted formats
    clipboardHas.value = clipboard.hasData()
    getGrid()?.setMarchingAnts(null)
    // Reads wait for the paste's write, so `after` holds the pasted inputs.
    const after = Object.assign({}, ...(await Promise.all(rects.map((r) => _readInputs(r, sn)))))
    const source = cutSrc && {
      sheet: cutSrc.sheet,
      before: srcBefore,
      after: await _readInputs(cutSrc.rect, cutSrc.sheet),
    }
    _showInputInFormulaBar(activeCell.value) // fx bar tracks the pasted anchor
    const afterFmt = Object.assign({}, ...rects.map((r) => _captureFormatsRange(r, sn)))
    const afterVal = Object.assign({}, ...rects.map((r) => _captureValidationRange(r, sn)))
    const cfAfter = condFormat?.getRules?.(sn)?.length ?? 0
    const refs = _diffRefs(before, after)
    const rowH = refitRowsFor?.(sn, after) // as in onDocPaste
    if (refs.length || cfBefore !== cfAfter) {
      _queueOp({
        opType: 'paste',
        subSheet: sn,
        cellRefs: refs,
        before,
        after,
        summary: `Pasted ${kind} into ${refs.length} cell${refs.length === 1 ? '' : 's'}`,
        ...(source && { source }),
      })
      _pushPasteHistory({
        opType: 'paste',
        subSheet: sn,
        cellRefs: refs,
        before,
        after,
        beforeFormats: beforeFmt,
        afterFormats: afterFmt,
        beforeValidation: beforeVal,
        afterValidation: afterVal,
        cfChanged: cfBefore !== cfAfter,
        ...(source && { source }),
        ...(rowH && { beforeRowH: rowH.before, afterRowH: rowH.after }),
      })
      syncFlags()
    }
    isDirty.value = true
    // Pivot recompute is handled centrally: the paste routed through
    // batchSetCells, whose onCellsChanged callback recomputes affected pivots.
  }

  // Push the right history entry for a paste. Cell + format + validation
  // diffs round-trip through op-based undo (~10 µs); cond-format rule
  // additions aren't tracked in the op shape, so when the rule list
  // changed we fall back to a full engine snapshot for correctness.
  function _pushPasteHistory(op) {
    if (op.cfChanged) {
      history.push()
      return
    }
    history.pushOp(op)
  }

  return {
    refocusGridIfIdle: _refocusGridIfIdle,
    onDocCopy,
    onDocCut,
    onDocPaste,
    doPasteSpecial,
  }
}
