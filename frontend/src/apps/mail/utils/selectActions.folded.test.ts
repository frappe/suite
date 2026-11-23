import { fromPartial } from '@total-typescript/shoehorn'
import { Folder } from 'lucide-vue-next'
import { expect, it } from 'vitest'

import type { Thread } from '@/apps/mail/types'

import { foldedToolbar, selectActions, type SelectHandlers } from './selectActions'

// One read, unstarred, unpinned mail ticked in an Inbox, with both filing menus on offer.
const folded = () => {
  const row = fromPartial<Thread>({
    messages: [],
    mailboxes: [],
    seen: 1,
    flagged: 0,
    junk: 0,
    pinned: 0,
  })
  const actions = selectActions(
    () => [row],
    () => ({ archive: false, trash: false, drafts: false, pinnable: true, snoozable: true }),
    fromPartial<SelectHandlers>({}),
  )
  const filing = ['Move To', 'Folders'].map((label) => ({ label, icon: Folder, options: [] }))
  return foldedToolbar(actions, filing)
}
const name = (entry: { label: string; shortLabel?: string }) => entry.shortLabel ?? entry.label

// Beside a reading pane the toolbar's only buttons were Move To and Folders; reading, archiving,
// junking and trashing, what a selection is most often ticked for, were in the menu.
it('keeps what is done to the mail as buttons and files the rest in the menu, in the toolbar order', () => {
  const { buttons, menu } = folded()
  expect(buttons.map(name)).toEqual(['Unread', 'Archive', 'Junk', 'Trash'])
  expect(menu.map((group) => group.map(name))).toEqual([
    ['Move To', 'Folders'],
    ['Snooze', 'Pin', 'Star'],
  ])
})
