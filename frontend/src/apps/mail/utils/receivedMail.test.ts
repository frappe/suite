import { expect, it } from 'vitest'

import {
  archivable,
  holdsReceivedMail,
  isReceived,
  receivedFolders,
  searchFolders,
  unarchivable,
} from './receivedMail'

const in_ = (...ids: string[]) => ids.map((mailbox_id) => ({ mailbox_id }))

it('tells mail you received from your sent mail and your drafts', () => {
  expect(isReceived({ mailboxes: in_('inbox', 'projects') }, 'sent')).toBe(true)
  expect(isReceived({ mailboxes: in_('sent', 'projects') }, 'sent')).toBe(false)
  expect(isReceived({ draft: 1, mailboxes: in_('drafts') }, 'sent')).toBe(false)
})

it('finds nothing to archive in a conversation of only your own mail', () => {
  const outreach = [{ mailboxes: in_('sent') }, { draft: 1, mailboxes: in_('drafts') }]
  expect(holdsReceivedMail(outreach, 'sent')).toBe(false)
  expect(holdsReceivedMail([...outreach, { mailboxes: in_('inbox') }], 'sent')).toBe(true)
})

it('stops offering Archive once the received mail is archived, whatever your reply says', () => {
  const boxes = { sent: 'sent', archive: 'archive', inbox: 'inbox' }
  const reply = { mailboxes: in_('sent') }
  expect(archivable([{ mailboxes: in_('inbox') }, reply], boxes)).toBe(true)
  expect(archivable([{ mailboxes: in_('archive', 'projects') }, reply], boxes)).toBe(false)
  expect(archivable([reply], boxes)).toBe(false)
  // A reply an earlier move filed in the Inbox: Archive still has it to clear.
  expect(archivable([{ mailboxes: in_('sent', 'inbox') }], boxes)).toBe(true)
})

it('offers Unarchive exactly where Archive has nothing left to do', () => {
  const boxes = { sent: 'sent', archive: 'archive', inbox: 'inbox' }
  const reply = { mailboxes: in_('sent') }
  expect(unarchivable([{ mailboxes: in_('archive', 'projects') }, reply], boxes)).toBe(true)
  expect(unarchivable([{ mailboxes: in_('inbox') }, reply], boxes)).toBe(false)
  expect(unarchivable([{ mailboxes: in_('projects') }, reply], boxes)).toBe(false)
  expect(unarchivable([reply], boxes)).toBe(false)
  // Your own mail that an earlier Archive filed away, with nothing received beside it.
  expect(unarchivable([{ mailboxes: in_('sent', 'archive') }], boxes)).toBe(true)
})

it("names where a conversation's received mail is filed, apart from the Inbox", () => {
  const boxes = { sent: 'sent', inbox: 'inbox', drafts: 'drafts' }
  const conversation = [
    { mailboxes: in_('inbox', 'projects') },
    { mailboxes: in_('archive', 'projects') },
    { mailboxes: in_('sent', 'clients') },
  ]
  expect(receivedFolders(conversation, boxes, 'sent').map((f) => f.mailbox_id)).toEqual([
    'projects',
    'archive',
  ])
  expect(receivedFolders([{ mailboxes: in_('inbox') }], boxes, 'sent')).toEqual([])
})

it('names where your own outreach is filed, when nothing was received', () => {
  const boxes = { sent: 'sent', inbox: 'inbox', drafts: 'drafts' }
  const outreach = [{ mailboxes: in_('sent', 'clients') }]
  expect(receivedFolders(outreach, boxes, 'sent').map((f) => f.mailbox_id)).toEqual(['clients'])
})

it('says where a found conversation is, the Inbox included, never your Sent beside received mail', () => {
  const boxes = { sent: 'sent', drafts: 'drafts' }
  const conversation = [
    { mailboxes: in_('inbox', 'projects') },
    { mailboxes: in_('sent') },
    { draft: 1, mailboxes: in_('drafts') },
  ]
  expect(searchFolders(conversation, boxes).map((f) => f.mailbox_id)).toEqual(['inbox', 'projects'])
})

it('answers Sent for a found conversation of only your own mail', () => {
  const boxes = { sent: 'sent', drafts: 'drafts' }
  const outreach = [{ mailboxes: in_('sent') }, { draft: 1, mailboxes: in_('drafts') }]
  expect(searchFolders(outreach, boxes).map((f) => f.mailbox_id)).toEqual(['sent'])
})
