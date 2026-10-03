import { reactive } from 'vue'

// Estimated rendered heights per menu mode (px). Used to pre-flip before first paint.
const MENU_HEIGHT_EST = { cell: 660, colHeader: 240, rowHeader: 240 }

/**
 * @param {{ getGrid: () => object, getViewport?: () => { width: number, height: number } }} opts
 */
export function useContextMenu({ getGrid, getViewport = () => ({ width: window.innerWidth, height: window.innerHeight }) }) {
  const contextMenu = reactive({
    open: false, x: 0, y: 0, bottom: 0, useBottom: false, maxH: 0,
    targetRow: 0, targetCol: 0, mode: 'cell',
  })

  const tabMenu = reactive({ open: false, x: 0, bottom: 0, name: '' })

  function openCanvasContextMenu(e) {
    e.preventDefault()
    tabMenu.open = false
    const grid = getGrid()
    const hit  = grid.getHitRegion(e.clientX, e.clientY)

    // Restore a pre-mousedown multi-cell selection when right-clicking inside it,
    // so context-menu actions apply to the full selection, not just the cursor cell.
    const pre  = grid.getPreMousedownSel?.()
    const cur  = grid.getSelection()
    const hc   = hit.cell
    if (pre && hc &&
        (pre.r0 !== pre.r1 || pre.c0 !== pre.c1) &&
        hc.r >= pre.r0 && hc.r <= pre.r1 &&
        hc.c >= pre.c0 && hc.c <= pre.c1 &&
        (cur.r0 !== pre.r0 || cur.r1 !== pre.r1 || cur.c0 !== pre.c0 || cur.c1 !== pre.c1)) {
      grid.setSelection?.(pre)
    }

    const sel = grid.getSelection()
    contextMenu.targetRow = hit.headerRow ?? hit.cell?.r ?? sel.r0
    contextMenu.targetCol = hit.headerCol ?? hit.cell?.c ?? sel.c0
    contextMenu.mode = hit.headerCol != null ? 'colHeader'
                     : hit.headerRow != null ? 'rowHeader'
                     : 'cell'

    const vp = getViewport()
    const spaceBelow = vp.height - e.clientY
    const spaceAbove = e.clientY
    contextMenu.useBottom = spaceBelow < (MENU_HEIGHT_EST[contextMenu.mode] ?? 300) && spaceAbove > spaceBelow
    contextMenu.x      = Math.min(e.clientX, vp.width - 260)
    contextMenu.y      = e.clientY
    contextMenu.bottom = vp.height - e.clientY
    contextMenu.maxH   = (contextMenu.useBottom ? spaceAbove : spaceBelow) - 8
    contextMenu.open   = true
  }

  function openTabMenu(e, name) {
    const vp = getViewport()
    contextMenu.open = false
    tabMenu.name   = name
    tabMenu.x      = Math.min(e.clientX, vp.width - 220)
    tabMenu.bottom = vp.height - e.clientY + 2
    tabMenu.open   = true
  }

  return { contextMenu, tabMenu, openCanvasContextMenu, openTabMenu }
}
