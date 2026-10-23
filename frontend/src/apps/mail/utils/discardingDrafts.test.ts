import { afterEach, expect, it } from 'vitest'

import { useDiscardingDrafts } from './composables'

const { holdDraft, releaseDraft, isDiscarding, withoutHeldDrafts } = useDiscardingDrafts()

// A reply draft under the mail it answers, as a row lists it.
const conversation = {
  messages: [
    { id: 'original', draft: 0 },
    { id: 'reply', draft: 1 },
  ],
}

afterEach(() => releaseDraft('reply'))

it('drops a Drafts row once its draft is discarded, though it also carries the mail it answers', () => {
  holdDraft('reply')
  expect(isDiscarding(conversation, { inDrafts: true })).toBe(true)
})

it('keeps the conversation elsewhere, where it is listed for the mail it answers', () => {
  holdDraft('reply')
  expect(isDiscarding(conversation)).toBe(false)
})

it('keeps a Drafts row while one of its drafts is still there', () => {
  holdDraft('reply')
  const twoDrafts = { messages: [...conversation.messages, { id: 'second', draft: 1 }] }
  expect(isDiscarding(twoDrafts, { inDrafts: true })).toBe(false)
})

it('keeps a row nothing is being discarded from', () => {
  expect(isDiscarding(conversation, { inDrafts: true })).toBe(false)
})

// A conversation in Inbox whose newest message is a reply draft: the row reads off the draft.
const inboxRow = () =>
  ({
    draft: 1,
    preview: 'my reply',
    from_name: 'Me',
    from_email: 'me@example.com',
    recipients: [],
    messages: [
      {
        id: 'original',
        draft: 0,
        preview: 'the question',
        from_name: 'Pat',
        from_email: 'pat@example.com',
        recipients: [],
      },
      {
        id: 'reply',
        draft: 1,
        preview: 'my reply',
        from_name: 'Me',
        from_email: 'me@example.com',
        recipients: [],
      },
    ],
  }) as unknown as Parameters<typeof withoutHeldDrafts>[0]

it('reads a row off the message before a discarded reply draft', () => {
  holdDraft('reply')
  const row = withoutHeldDrafts(inboxRow())
  expect(row.draft).toBe(0)
  expect(row.preview).toBe('the question')
  expect(row.from_email).toBe('pat@example.com')
  expect(row.messages.map((m) => m.id)).toEqual(['original'])
})

it('leaves a row alone while nothing in it is being discarded', () => {
  const row = inboxRow()
  expect(withoutHeldDrafts(row)).toBe(row)
})
