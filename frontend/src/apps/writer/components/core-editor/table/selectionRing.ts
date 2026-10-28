export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export const boxOf = (rect: DOMRect): Box => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
})

/** The smallest box around every element's rect */
export function unionBox(elements: Iterable<Element>): Box | null {
  const rects = [...elements].map((element) => element.getBoundingClientRect())
  if (!rects.length) return null
  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return { left, top, width: right - left, height: bottom - top }
}

const CARD_INNER_RADIUS = '11px'

/**
 * frappe-ui draws a multi-cell selection as one box over the cells' border boxes. Inside the table
 * its left and top lines move out onto the neighbours' rules, as a single cell's ring does
 * (table.css). On the table's edge they keep a pixel inside the card's frame, and at a corner the
 * box takes the frame's inner radius, so the rounded card does not clip it.
 */
export function fitSelectionBox(wrapper: HTMLElement, selection: Box) {
  const ring = wrapper.querySelector<HTMLElement>('.table-selection-box')
  const table = wrapper.querySelector('table')?.getBoundingClientRect()
  if (!ring || !table) return
  const near = (a: number, b: number) => Math.abs(a - b) <= 1.5
  const edge = {
    top: near(selection.top, table.top),
    left: near(selection.left, table.left),
    right: near(selection.left + selection.width, table.right),
    bottom: near(selection.top + selection.height, table.bottom),
  }
  const left = edge.left ? 1 : -1
  const top = edge.top ? 1 : -1
  ring.style.marginLeft = `${left}px`
  ring.style.marginTop = `${top}px`
  ring.style.width = `${selection.width - left - (edge.right ? 1 : 0)}px`
  ring.style.height = `${selection.height - top - (edge.bottom ? 1 : 0)}px`
  const radius = (isCorner: boolean) => (isCorner ? CARD_INNER_RADIUS : '0px')
  ring.style.borderTopLeftRadius = radius(edge.top && edge.left)
  ring.style.borderTopRightRadius = radius(edge.top && edge.right)
  ring.style.borderBottomLeftRadius = radius(edge.bottom && edge.left)
  ring.style.borderBottomRightRadius = radius(edge.bottom && edge.right)
}
