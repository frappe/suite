// Style for an absolutely-positioned outline drawn over a cell range inside the
// grid-wrap (the filter-range and pivot highlights).
//
// The range can be far taller/wider than the viewport. Letting the div run its
// true extent (tens of thousands of px on a large sheet) gives the
// overflow:hidden grid-wrap scrollable overflow, and a stray focus /
// scrollIntoView then scrolls it — dragging the whole <canvas> off-position.
// That's the "grid jumps to the middle and freezes after filtering" bug.
//
// So we clamp the far edges to the viewport. The border on any edge pushed past
// the viewport is dropped: it was clipped off-screen before the clamp anyway, so
// hiding it keeps the outline looking identical (a frame open at the clipped
// side) instead of drawing a spurious line at the viewport edge.
//
// `tl`/`br` are the top-left and bottom-right cell rects (canvas-local CSS px,
// zoom already applied). Returns null when the range sits entirely under the
// header gutter (nothing to draw).
export function overlayRectStyle(tl, br, { headerX, headerY, viewW, viewH }) {
  const right = br.x + br.width
  const bottom = br.y + br.height
  if (bottom <= headerY || right <= headerX) return null

  const top = Math.max(tl.y, headerY)
  const left = Math.max(tl.x, headerX)
  const clampedRight = Math.min(right, viewW)
  const clampedBottom = Math.min(bottom, viewH)

  const style = {
    top: top + 'px',
    left: left + 'px',
    width: Math.max(0, clampedRight - left) + 'px',
    height: Math.max(0, clampedBottom - top) + 'px',
  }
  if (right > viewW) style.borderRightWidth = '0'
  if (bottom > viewH) style.borderBottomWidth = '0'
  return style
}
