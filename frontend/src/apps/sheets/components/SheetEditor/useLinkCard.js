// The link hover card: a Google-style preview card over a linked cell.
// Extracted from SheetEditor/index.vue. The card itself is LinkPreviewCard.vue.
//
// Usage:
//   const { linkCard, onLinkHover, onLinkCardEnter, ... } = useLinkCard({
//     formats, currentSheet, activeCell, formulaValue, readOnly, gridWrapRef,
//     getGrid, inputAt, readInput, writeInputs, cellBlocked, cellSilentlyProtected,
//     recordFormatOp, pushEditOp, refreshActiveFormat, syncFlags, markDirty,
//     openHyperlinkDialog })
//
// Favicon/title/description come from the server (see
// suite/sheets/link_preview.py), plus copy / edit / unlink actions and the
// "Replace URL with its title?" offer for auto-linked cells.

import { reactive } from 'vue'

import { isAutoLinkText } from '../../engine/links.js'
import { fetchLinkPreview } from '../../services/linkPreview.js'

export function useLinkCard({
  formats,
  currentSheet,
  activeCell,
  formulaValue,
  readOnly,
  gridWrapRef,
  getGrid,
  inputAt,
  readInput,
  writeInputs,
  cellBlocked,
  cellSilentlyProtected,
  recordFormatOp,
  pushEditOp,
  refreshActiveFormat,
  syncFlags,
  markDirty,
  openHyperlinkDialog,
}) {
  const linkCard = reactive({
    open: false,
    id: null,
    r: 0,
    c: 0,
    url: '',
    anchor: null,
    // { x, y } canvas-local px
    preview: {},
    // { loading, error, title, description, favicon, host }
    offerReplace: false,
  })
  let _linkShowTimer = null
  let _linkHideTimer = null

  // Canvas feed — fires once on entering/leaving a linked cell. Short delays on
  // both edges so the card neither flickers during a sweep across links nor
  // vanishes while the pointer travels from the cell into the card.
  function onLinkHover(info) {
    if (info) {
      clearTimeout(_linkHideTimer)
      if (linkCard.open && linkCard.id === info.id && linkCard.url === info.url) return
      clearTimeout(_linkShowTimer)
      _linkShowTimer = setTimeout(() => _openLinkCard(info), 300)
    } else {
      clearTimeout(_linkShowTimer)
      _scheduleLinkCardHide()
    }
  }
  function _scheduleLinkCardHide() {
    clearTimeout(_linkHideTimer)
    _linkHideTimer = setTimeout(() => {
      linkCard.open = false
    }, 250)
  }
  function onLinkCardEnter() {
    clearTimeout(_linkHideTimer)
  }
  function onLinkCardLeave() {
    _scheduleLinkCardHide()
  }
  function _openLinkCard(info) {
    const rect = getGrid()?.getCellRect?.(info.r, info.c)
    if (!rect) return
    const CARD_W = 340,
      EST_H = 120
    const wrapW = gridWrapRef.value?.offsetWidth ?? Infinity
    const wrapH = gridWrapRef.value?.offsetHeight ?? Infinity
    const x = Math.max(0, Math.min(rect.x, wrapW - CARD_W - 8))
    const y =
      rect.y + rect.height + EST_H > wrapH ? Math.max(0, rect.y - EST_H) : rect.y + rect.height + 2
    const isHttp = /^https?:\/\//i.test(info.url)
    Object.assign(linkCard, {
      open: true,
      id: info.id,
      r: info.r,
      c: info.c,
      url: info.url,
      anchor: {
        x,
        y,
      },
      preview: isHttp
        ? {
            loading: true,
          }
        : {},
      offerReplace: false,
    })
    if (!isHttp) return
    fetchLinkPreview(info.url).then((res) => {
      // Pointer may have moved on — only fill the card still showing this URL.
      if (!linkCard.open || linkCard.url !== info.url) return
      linkCard.preview = {
        ...res,
        loading: false,
      }
      linkCard.offerReplace =
        !readOnly.value &&
        !!res.title &&
        isAutoLinkText(inputAt(linkCard.id) ?? '', linkCard.url) &&
        !cellSilentlyProtected(linkCard.id)
    })
  }
  function openLinkCardUrl() {
    window.open(linkCard.url, '_blank', 'noopener,noreferrer')
  }
  function editLinkCardCell() {
    linkCard.open = false
    getGrid()?.moveTo?.(linkCard.r, linkCard.c) // onSelect syncs activeCell
    openHyperlinkDialog()
  }
  function unlinkLinkCardCell() {
    const sn = currentSheet.value
    const id = linkCard.id
    linkCard.open = false
    if (!id || readOnly.value || cellBlocked(id, sn)) return
    recordFormatOp([id], sn, () =>
      formats.applyToRange(
        [id],
        {
          hyperlink: null,
        },
        sn,
      ),
    )
    refreshActiveFormat()
    getGrid()?.render()
    syncFlags()
    markDirty()
  }
  async function replaceLinkWithTitle() {
    const sn = currentSheet.value
    const id = linkCard.id
    const title = linkCard.preview?.title
    linkCard.open = false
    if (!id || !title || readOnly.value || cellBlocked(id, sn)) return
    const before = { [id]: await readInput(id, sn) }
    const after = { [id]: title }
    writeInputs(sn, after)
    pushEditOp(sn, before, after, 'Replace URL with title')
    if (activeCell.value === id) formulaValue.value = title
  }

  return {
    linkCard,
    onLinkHover,
    onLinkCardEnter,
    onLinkCardLeave,
    openLinkCardUrl,
    editLinkCardCell,
    unlinkLinkCardCell,
    replaceLinkWithTitle,
  }
}
