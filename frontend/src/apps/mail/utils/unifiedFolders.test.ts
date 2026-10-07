import { describe, expect, it } from 'vitest'

import type { MailboxData } from '@/apps/mail/types'

import {
  currentMailboxParam,
  mailboxForUnifiedFolder,
  mailboxIdForParam,
  mailboxParam,
  openedMailboxId,
  unifiedFolderFor,
} from './unifiedFolders'

const mailbox = (id: string, slug: string | null): MailboxData =>
  ({ id, slug, _name: slug ?? id, role: null }) as MailboxData

const mailboxes = [
  mailbox('a', 'inbox'),
  mailbox('e', 'sent'),
  mailbox('k', 'receipts'),
  mailbox('m', 'receipts'),
  mailbox('s', null),
]

describe('a folder in the URL', () => {
  it('goes by its slug', () => {
    expect(mailboxParam('e', mailboxes)).toBe('sent')
  })

  it('keeps its id when another folder of the account shares the slug', () => {
    expect(mailboxParam('k', mailboxes)).toBe('k')
    expect(mailboxParam('m', mailboxes)).toBe('m')
  })

  it('keeps its id when it has no slug', () => {
    expect(mailboxParam('s', mailboxes)).toBe('s')
  })

  it('leaves views that are not mailboxes alone', () => {
    expect(mailboxParam('starred', mailboxes)).toBe('starred')
  })

  it('round-trips every folder back to its id', () => {
    for (const { id } of mailboxes)
      expect(mailboxIdForParam(mailboxParam(id, mailboxes), mailboxes)).toBe(id)
  })

  it('still opens a link made with an id', () => {
    expect(mailboxIdForParam('e', mailboxes)).toBe('e')
  })

  it('passes views that are not mailboxes through', () => {
    expect(mailboxIdForParam('search', mailboxes)).toBe('search')
  })
})

describe('switching between an account and all accounts', () => {
  it('opens the same folder across all accounts, from a slug or an id', () => {
    expect(unifiedFolderFor('sent', mailboxes)).toBe('sent')
    expect(unifiedFolderFor('e', mailboxes)).toBe('sent')
    expect(unifiedFolderFor('starred', mailboxes)).toBe('starred')
  })

  it('falls back to the Inbox from a view that is not a folder', () => {
    expect(unifiedFolderFor('search', mailboxes)).toBe('inbox')
  })

  it("finds the account's own folder for a merged one", () => {
    expect(mailboxForUnifiedFolder('sent', mailboxes)).toBe('e')
    expect(mailboxForUnifiedFolder('starred', mailboxes)).toBe('starred')
    expect(mailboxForUnifiedFolder('cloud', mailboxes)).toBeUndefined()
  })
})

describe('a folder renamed while it is open', () => {
  const before = [mailbox('a', 'inbox'), mailbox('c', 'cloud')]
  const after = [mailbox('a', 'inbox'), mailbox('c', 'infra')]

  it('stays open under its old name', () => {
    expect(openedMailboxId('acct', 'cloud', before)).toBe('c')
    expect(openedMailboxId('acct', 'cloud', after)).toBe('c')
  })

  it('moves the URL to its new name', () => {
    openedMailboxId('acct', 'cloud', before)
    expect(currentMailboxParam('acct', 'cloud', after)).toBe('infra')
  })

  it('is not mistaken for a folder of another account', () => {
    openedMailboxId('acct', 'cloud', before)
    expect(openedMailboxId('other', 'cloud', after)).toBe('cloud')
  })

  it('names nothing once deleted', () => {
    openedMailboxId('acct', 'cloud', before)
    expect(currentMailboxParam('acct', 'cloud', [mailbox('a', 'inbox')])).toBeNull()
  })

  it('leaves views that are not mailboxes alone', () => {
    expect(currentMailboxParam('acct', 'starred', after)).toBe('starred')
  })
})
