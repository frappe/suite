import { describe, expect, it } from 'vitest'

import { fitColumns, measuredWidth } from './listColumns'

const WIDTHS: Record<string, number> = {
  access: 160,
  kind: 128,
  owner: 192,
  size: 96,
  modified: 128,
}
const width = (column: string) => WIDTHS[column] ?? 0
const ALL = ['access', 'kind', 'owner', 'size', 'modified']

describe('fitColumns', () => {
  // Name takes 240, the menu 40, and each of the n + 1 gaps between the n + 2 columns 8.
  it.each([
    [1032, ALL],
    [1031, ['access', 'owner', 'size', 'modified']],
    [896, ['access', 'owner', 'size', 'modified']],
    [895, ['access', 'owner', 'modified']],
    [791, ['access', 'modified']],
    [591, ['modified']],
    [424, ['modified']],
    [423, []],
  ])(
    'keeps what fits a %i px list, dropping Type, Size, Owner, Access, then Modified',
    (room, kept) => {
      expect(fitColumns(ALL, room, width)).toEqual(kept)
    },
  )

  it('drops only chosen columns, in the same order', () => {
    expect(fitColumns(['owner', 'modified'], 624, width)).toEqual(['owner', 'modified'])
    expect(fitColumns(['owner', 'modified'], 623, width)).toEqual(['modified'])
  })

  it('counts a wider gap between the columns', () => {
    // 240 + 40 + 192 + 128 and three gaps of 24.
    expect(fitColumns(['owner', 'modified'], 672, width, 24)).toEqual(['owner', 'modified'])
    expect(fitColumns(['owner', 'modified'], 671, width, 24)).toEqual(['modified'])
  })
})

describe('measuredWidth', () => {
  it('fits the widest Access label beside its icon, within bounds', () => {
    expect(measuredWidth('access', [40, 101.2])).toBe(124)
    expect(measuredWidth('access', [20])).toBe(80)
    expect(measuredWidth('access', [300])).toBe(160)
  })

  it('fits the widest type name, and room for the header', () => {
    expect(measuredWidth('kind', [42, 86.4])).toBe(87)
    expect(measuredWidth('kind', [27])).toBe(56)
    expect(measuredWidth('kind', [200])).toBe(112)
  })

  it('fits the widest owner beside the avatar, up to a typical long name', () => {
    expect(measuredWidth('owner', [99])).toBe(123)
    expect(measuredWidth('owner', [30])).toBe(96)
    expect(measuredWidth('owner', [156])).toBe(160)
  })
})
