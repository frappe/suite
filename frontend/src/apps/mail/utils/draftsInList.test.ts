import { afterEach, describe, expect, it } from 'vitest'

import {
  beginListRead,
  draftInList,
  forgetDraftInList,
  showDraftInList,
} from '@/apps/mail/utils/draftsInList'

const row = (messages: string[]) => ({
  id: messages.at(-1)!,
  thread_id: 't1',
  account: 'acc',
  messages: messages.map((id) => ({ id })),
})

afterEach(() => forgetDraftInList('acc', 't1'))

describe('a reply drafted inside a conversation, on its list row', () => {
  it('shows on the row with its words, leaving out what it quotes', () => {
    showDraftInList(
      'acc',
      't1',
      'd1',
      '<p>Sounds good,   see you then.</p><div class="gmail_quote"><div class="gmail_attr">On Mon, Ana wrote:</div><blockquote class="gmail_quote"><p>Lunch on Friday?</p></blockquote></div>',
    )

    expect(draftInList('acc', row(['m1']))?.preview).toBe('Sounds good, see you then.')
  })

  it('gives way once the row holds the draft as last saved', () => {
    showDraftInList('acc', 't1', 'd2', '<p>Second save</p>')

    expect(draftInList('acc', row(['m1', 'd1']))?.preview).toBe('Second save')
    expect(draftInList('acc', row(['m1', 'd2']))).toBeUndefined()
  })

  it("stays on its own account's conversation", () => {
    showDraftInList('acc', 't1', 'd1', '<p>Hello</p>')

    expect(draftInList('other', row(['m1']))).toBeUndefined()
  })

  it('is gone once a list read begun after it was saved comes back without it, as when it was discarded, deleted or sent elsewhere', () => {
    showDraftInList('acc', 't1', 'd1', '<p>Hello</p>')

    const readIn = beginListRead()
    readIn([row(['m1'])])

    expect(draftInList('acc', row(['m1']))).toBeUndefined()
  })

  it('stays through a list read that began before it was saved', () => {
    const readIn = beginListRead()
    showDraftInList('acc', 't1', 'd1', '<p>Hello</p>')
    readIn([row(['m1'])])

    expect(draftInList('acc', row(['m1']))?.preview).toBe('Hello')
  })

  it('is gone once forgotten, as on a send or a discard', () => {
    showDraftInList('acc', 't1', 'd1', '<p>Hello</p>')
    forgetDraftInList('acc', 't1')

    expect(draftInList('acc', row(['m1']))).toBeUndefined()
  })
})
