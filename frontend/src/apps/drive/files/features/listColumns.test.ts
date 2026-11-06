import { describe, expect, it } from 'vitest'

import { accessWidth, fitColumns } from './listColumns'

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
})

describe('accessWidth', () => {
  it('fits the widest label beside its icon, within bounds', () => {
    expect(accessWidth([40, 101.2])).toBe(124)
    expect(accessWidth([20])).toBe(80)
    expect(accessWidth([300])).toBe(160)
  })
})
