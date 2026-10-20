import { describe, expect, it } from 'vitest'

import type { DocumentThread } from '@/apps/drive'

import { authorLabel, commentTime } from './comments'

type ThreadComment = DocumentThread['comments'][number]

function comment(fields: Partial<ThreadComment>): ThreadComment {
  return {
    name: 'c1',
    thread: 't1',
    node: 'n1',
    content: 'Looks good',
    author: 'maya@northwind.test',
    author_name: null,
    mentions: [],
    creation: null,
    modified: null,
    ...fields,
  }
}

describe('a comment in the Slides panel', () => {
  it('names a signed-in author by full name, not "Someone" or their email', () => {
    const signedIn = comment({
      person: { id: 'maya@northwind.test', full_name: 'Maya Chen', user_image: null },
    })

    expect(authorLabel(signedIn)).toBe('Maya Chen')
  })

  it('shows when it was posted, and nothing when Drive sent no time', () => {
    const posted = comment({ creation: '2026-10-21T09:30:00Z' })

    expect([commentTime(posted).length > 0, commentTime(comment({}))]).toEqual([true, ''])
  })
})
