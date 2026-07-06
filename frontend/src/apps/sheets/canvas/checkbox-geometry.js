// Geometry for data-validation checkbox cells. Shared by the cell painter
// (which draws the box) and the grid hit-test (which decides whether a click
// toggled it) so the clickable box always lines up with what's painted.

export const CHECKBOX = {
  maxSize: 16,  // the box never grows larger than this
  minSize: 8,   // below this the row is too short to draw a box
  margin:  6,   // keeps the box off the cell's top/bottom edge
}

// Box placement inside a cell of `cellW` × `cellH`, offsets from the cell's
// top-left corner. Always centred, regardless of the cell's text alignment
// (matches Sheets). Returns { x, y, size }.
export function checkboxRect(cellW, cellH) {
  const size = Math.min(CHECKBOX.maxSize, cellH - CHECKBOX.margin, cellW - CHECKBOX.margin)
  return {
    x: (cellW - size) / 2,
    y: (cellH - size) / 2,
    size,
  }
}
