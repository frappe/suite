import { expect, it } from 'vitest'

import { searchSettings } from '@/shell/settings/searchSettings'
import type { VisibleSettingsGroup } from '@/shell/settings/settings'

function body() {
  return Promise.resolve({ render: () => null })
}

const groups: VisibleSettingsGroup[] = [
  {
    label: 'Account',
    tabs: [{ id: 'account.profile', label: () => 'Profile', icon: '', body }],
  },
  {
    label: 'Mail',
    tabs: [
      {
        id: 'mail.sending',
        label: () => 'Sending',
        icon: '',
        body,
        sections: [
          { id: 'signatures', label: () => 'Signatures' },
          { id: 'auto-reply', label: () => 'Auto-reply', keywords: () => 'vacation, away' },
        ],
      },
      {
        id: 'mail.advanced',
        label: () => 'Advanced',
        icon: '',
        body,
        sections: [
          { id: 'import', label: () => 'Import' },
          { id: 'export', label: () => 'Export', keywords: () => 'download, backup' },
        ],
      },
    ],
  },
  {
    label: 'Calendar',
    tabs: [
      {
        id: 'calendar.advanced',
        label: () => 'Advanced',
        icon: '',
        body,
        sections: [{ id: 'import', label: () => 'Import' }],
      },
    ],
  },
]

/** What a search finds, one line per tab: `Group > Tab: section, section`. */
function found(query: string) {
  return searchSettings(groups, query).flatMap((group) =>
    group.tabs.map(({ tab, sections }) => {
      const name = tab.label()
      const names = sections.map((section) => section.label()).join(', ')
      return `${group.label} > ${name}: ${names}`
    }),
  )
}

it('lists every tab and no section when nothing is searched for', () => {
  expect(found('  ')).toEqual([
    'Account > Profile: ',
    'Mail > Sending: ',
    'Mail > Advanced: ',
    'Calendar > Advanced: ',
  ])
})
it('finds a section by its label, under each tab that has one', () => {
  expect(found('Import')).toEqual(['Mail > Advanced: Import', 'Calendar > Advanced: Import'])
})
it('finds a section by a keyword that is not on the page', () => {
  expect(found('vacation')).toEqual(['Mail > Sending: Auto-reply'])
})
it('narrows a section to one app when the app is named too, in any order', () => {
  expect(found('import mail')).toEqual(['Mail > Advanced: Import'])
})
it('finds tabs by name without listing every section under them', () => {
  expect(found('mail')).toEqual(['Mail > Sending: ', 'Mail > Advanced: '])
  expect(found('calendar adv')).toEqual(['Calendar > Advanced: '])
})
it('finds the start of a word, whatever its case', () => {
  expect(found('SIGNAT')).toEqual(['Mail > Sending: Signatures'])
})
it('finds nothing, and no empty group, when a word matches nowhere', () => {
  expect(searchSettings(groups, 'import zebra')).toEqual([])
})
