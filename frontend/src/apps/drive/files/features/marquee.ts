/**
 * Drag to select: the rectangle a drag draws, and what it selects.
 *
 * Coordinates are relative to the listing element, not the viewport. The
 * listing moves when its container scrolls, so a point stays on the same
 * content while the page scrolls under the pointer.
 */

export interface Point {
  x: number
  y: number
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface MarqueeItem {
  id: string
  box: Box
}

/** The rectangle between the drag's start and the pointer, in either direction. */
export function boxBetween(a: Point, b: Point): Box {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  }
}

/** Whether two boxes share some area. Boxes that only touch at an edge do not. */
function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/**
 * The selection while a drag draws `box`. A plain drag selects only what the
 * box touches. An additive drag (Cmd, Ctrl or Shift held at the start) keeps
 * the selection from before the drag and adds to it, so an item the box
 * leaves goes back to how it was.
 */
export function marqueeSelection(input: {
  items: readonly MarqueeItem[]
  box: Box
  prior: readonly string[]
  additive: boolean
}): string[] {
  const hit = input.items.filter((item) => overlaps(item.box, input.box)).map((item) => item.id)
  if (!input.additive) return hit
  const kept = new Set(input.prior)
  return [...input.prior, ...hit.filter((id) => !kept.has(id))]
}
