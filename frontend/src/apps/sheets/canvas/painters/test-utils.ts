// Test doubles for painter tests: a recording 2d context and a fixed-size
// geometry (100px columns, 24px rows, headers at 50/24).

import { vi } from 'vitest'

export function createMockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    setLineDash: vi.fn(),
    scale: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: '',
    textAlign: '',
    lineDashOffset: 0,
  }
}

interface MockGeoOptions {
  colWidths?: { [c: number]: number }
  rowHeights?: { [r: number]: number }
  filterHidden?: Set<number>
}

export function createMockGeo({
  colWidths = {},
  rowHeights = {},
  filterHidden = new Set<number>(),
}: MockGeoOptions = {}) {
  const cw = vi.fn((c: number) => colWidths[c] ?? 100)
  const rh = vi.fn((r: number) => rowHeights[r] ?? 24)
  const colX = vi.fn((c: number) => 50 + c * 100)
  const rowY = vi.fn((r: number) => 24 + r * 24)
  const isFilterHidden = vi.fn((r: number) => filterHidden.has(r))
  return {
    cw,
    rh,
    colX,
    rowY,
    isFilterHidden,
    firstVisCol: vi.fn(() => 0),
    firstVisRow: vi.fn(() => 0),
    lastVisCol: vi.fn(() => 5),
    lastVisRow: vi.fn(() => 10),
    frozenW: vi.fn(() => 0),
    frozenH: vi.fn(() => 0),
    totalRows: vi.fn(() => 1000),
    totalCols: vi.fn(() => 26),
  }
}
