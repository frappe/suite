import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it } from 'vitest'

import type { Thread } from '@/apps/mail/types'

import { phoneBar, selectActions, type SelectHandlers } from './selectActions'

const thread = (seen: number, junk: number, mailbox: string) =>
  fromPartial<Thread>({
    messages: [{ mailboxes: [{ mailbox_id: mailbox }] }],
    mailboxes: [{ mailbox_id: mailbox }],
    seen,
    flagged: 0,
    junk,
    pinned: 0,
  })

// Ticked together in All Mail: one unread junk mail still in the Inbox, one read mail in Archive.
// Between them every action that is done to the mail is offered, opposites and all.
const mixed = () =>
  selectActions(
    () => [thread(0, 1, 'inbox'), thread(1, 0, 'archive')],
    () => ({
      archive: false,
      trash: false,
      drafts: false,
      archiveId: 'archive',
      inboxId: 'inbox',
      sent: 'sent',
    }),
    fromPartial<SelectHandlers>({ unarchive: () => {} }),
  ).filter((action) => action.condition() && action.group === 'act')

const names = (actions: { shortLabel: string }[]) => actions.map((action) => action.shortLabel)

it('keeps the bar to six buttons, folding the opposites a mixed selection adds into More', () => {
  const { buttons, folded } = phoneBar(mixed(), true)
  expect(names(buttons)).toEqual(['Read', 'Unread', 'Archive', 'Junk', 'Trash'])
  expect(names(folded)).toEqual(['Unarchive', 'Not Junk'])
})
