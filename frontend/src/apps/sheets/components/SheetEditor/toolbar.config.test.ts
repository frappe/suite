import { describe, it, expect, vi } from 'vitest'
// @ts-expect-error — plain JS config factory, no type declarations.
import { buildMoreToolbarOptions } from './toolbar.config.js'

type Option = { label: string; onClick: () => void }
type Group = { group: string; options: Option[] }

/** Every callback the factory accepts, as a spy, so a menu click is observable. */
function spies() {
  return {
    toggleFmt: vi.fn(),
    toggleWrap: vi.fn(),
    toggleFormatPainter: vi.fn(),
    clearFormatting: vi.fn(),
    adjustDecimals: vi.fn(),
    openCfDialog: vi.fn(),
    openHyperlinkDialog: vi.fn(),
    toggleMerge: vi.fn(),
    toggleSortFilter: vi.fn(),
    applyBorder: vi.fn(),
    zoomBy: vi.fn(),
    resetZoom: vi.fn(),
    openPivotDialog: vi.fn(),
    openChartDialog: vi.fn(),
    openNamedRangesDialog: vi.fn(),
    runSmartFill: vi.fn(),
  }
}

const labels = (groups: Group[]) => groups.flatMap((g) => g.options.map((o) => o.label))

const find = (groups: Group[], label: string) =>
  groups.flatMap((g) => g.options).find((o) => o.label === label)

/**
 * Actions the formatting toolbar never renders a button for, at any width.
 * Listed by hand from the toolbar markup in `index.vue`, not derived from the
 * factory — the whole point is that these have nowhere else to go.
 */
const MENU_ONLY = [
  'Smart Fill (Ctrl+E)',
  'Zoom in',
  'Zoom out',
  'Reset zoom',
  'Pivot table…',
  'Named ranges…',
]

describe('buildMoreToolbarOptions', () => {
  it('keeps every action when the toolbar has collapsed its inline groups', () => {
    const menu = buildMoreToolbarOptions({ ...spies(), collapsed: true }) as Group[]

    for (const label of MENU_ONLY) expect(labels(menu)).toContain(label)
    // The collapsed toolbar hides its inline buttons, so the menu carries those too.
    expect(labels(menu)).toContain('Strikethrough')
    expect(labels(menu)).toContain('Chart…')
    expect(labels(menu)).toContain('All borders')
  })

  it('offers only the menu-only actions when the toolbar is wide', () => {
    const menu = buildMoreToolbarOptions({ ...spies(), collapsed: false }) as Group[]

    expect(labels(menu).sort()).toEqual([...MENU_ONLY].sort())
  })

  it('never lists an empty group', () => {
    const menu = buildMoreToolbarOptions({ ...spies(), collapsed: false }) as Group[]

    expect(menu.length).toBeGreaterThan(0)
    for (const group of menu) expect(group.options.length).toBeGreaterThan(0)
  })

  it('runs the matching action when a menu option is chosen', () => {
    const actions = spies()

    for (const collapsed of [true, false]) {
      const menu = buildMoreToolbarOptions({ ...actions, collapsed }) as Group[]
      find(menu, 'Pivot table…')!.onClick()
      find(menu, 'Named ranges…')!.onClick()
      find(menu, 'Zoom in')!.onClick()
    }

    expect(actions.openPivotDialog).toHaveBeenCalledTimes(2)
    expect(actions.openNamedRangesDialog).toHaveBeenCalledTimes(2)
    expect(actions.zoomBy).toHaveBeenCalledWith(0.1)
  })
})
