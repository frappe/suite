import { describe, expect, it } from 'vitest'

import { getVisibleSettingsGroups } from '@/components/settings/settingsCatalog'
import type { SettingsGroup } from '@/components/settings/types'

const panel = {} as SettingsGroup['items'][number]['component']

describe('getVisibleSettingsGroups', () => {
  it('filters unavailable groups and tabs without mutating the catalog', () => {
    const groups: SettingsGroup[] = [
      {
        id: 'available',
        label: 'Available',
        items: [
          { label: 'Shown', value: 'shown', component: panel },
          { label: 'Hidden', value: 'hidden', component: panel, condition: () => false },
        ],
      },
      {
        id: 'hidden',
        label: 'Hidden',
        condition: () => false,
        items: [{ label: 'Other', value: 'other', component: panel }],
      },
    ]

    expect(getVisibleSettingsGroups(groups)).toMatchObject([
      { id: 'available', items: [{ value: 'shown' }] },
    ])
    expect(groups[0].items).toHaveLength(2)
  })

  it('removes groups with no visible tabs', () => {
    const groups: SettingsGroup[] = [
      {
        id: 'empty',
        label: 'Empty',
        items: [{ label: 'Hidden', value: 'hidden', component: panel, condition: () => false }],
      },
    ]

    expect(getVisibleSettingsGroups(groups)).toEqual([])
  })
})
