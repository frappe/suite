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

export function createMockGeo({ colWidths = {}, rowHeights = {}, filterHidden = new Set() } = {}) {
  const cw = vi.fn((c) => colWidths[c] ?? 100)
  const rh = vi.fn((r) => rowHeights[r] ?? 24)
  const colX = vi.fn((c) => 50 + c * 100)
  const rowY = vi.fn((r) => 24 + r * 24)
  const isFilterHidden = vi.fn((r) => filterHidden.has(r))
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
  }
}
