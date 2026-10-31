// How wide the reader has dragged Split View's list column. Kept per browser rather than per
// account: the right width is a matter of the screen it is read on, not of who is reading.

const KEY = 'mail-split-list-width'

// How narrow a drag may make each half, wide screens and narrow. The list's is SPLIT_LIST_CLASS's
// floor. The pane's is well above SPLIT_PANE_CLASS's: that one is the last resort of a shrinking
// window, and at it an open message loses its sender's name — not a width to be dragged to.
const floors = (wide: boolean) => ({ list: wide ? 320 : 256, pane: wide ? 480 : 400 })

/** A dragged width, held between the list's floor and whatever leaves the pane its own. */
export const clampListWidth = (width: number, rowWidth: number, wide: boolean): number => {
  const { list, pane } = floors(wide)
  return Math.round(Math.min(Math.max(width, list), Math.max(list, rowWidth - pane)))
}

export const readListWidth = (): number | undefined => {
  try {
    const width = Number(localStorage.getItem(KEY))
    return width > 0 ? width : undefined
  } catch {
    return undefined
  }
}

/** Saves a width, or forgets it, handing the column back to its default share of the screen. */
export const writeListWidth = (width?: number) => {
  try {
    if (width) localStorage.setItem(KEY, String(width))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage refused (a private window): the width lasts as long as the page.
  }
}
