import { describe, expect, it } from 'vitest'

import { fitColumns, measuredWidth } from './listColumns'

const WIDTHS = new Map([
  ['access', 160],
  ['kind', 128],
  ['owner', 192],
  ['size', 96],
  ['modified', 128],
])
const width = (column: string) => WIDTHS.get(column) ?? 0
const ALL = ['access', 'kind', 'owner', 'size', 'modified']

describe('fitColumns', () => {
  // Name takes 240, the menu 40, and each of the n + 1 gaps between the n + 2 columns 24.
  it.each([
    [1128, ALL],
    [1127, ['access', 'owner', 'size', 'modified']],
    [976, ['access', 'owner', 'size', 'modified']],
    [975, ['access', 'owner', 'modified']],
    [855, ['access', 'modified']],
    [639, ['modified']],
    [456, ['modified']],
    [455, []],
  ])(
    'keeps what fits a %i px list, dropping Type, Size, Owner, Access, then Modified',
    (room, kept) => {
      expect(fitColumns(ALL, room, width)).toEqual(kept)
    },
  )

  it('drops only chosen columns, in the same order', () => {
    // 240 + 40 + 192 + 128 and three gaps of 24.
    expect(fitColumns(['owner', 'modified'], 672, width)).toEqual(['owner', 'modified'])
    expect(fitColumns(['owner', 'modified'], 671, width)).toEqual(['modified'])
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
