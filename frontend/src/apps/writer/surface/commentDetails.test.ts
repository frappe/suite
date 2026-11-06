import { describe, expect, it } from 'vitest'

import { commentExcerpt, isEdited } from './commentDetails'

const POSTED = '2026-10-22 11:57:03.120000'

describe('comment details', () => {
  it('counts a comment as edited only when it changed after it was posted', () => {
    expect([
      isEdited({ creation: POSTED, modified: POSTED }),
      isEdited({ creation: POSTED, modified: '2026-10-22 11:57:03.400000' }),
      isEdited({ creation: POSTED, modified: '2026-10-22 11:58:10.000000' }),
      isEdited({ creation: null, modified: POSTED }),
    ]).toEqual([false, false, true, false])
  })

  it('names a comment on one line, with its mentions by name, cut when long', () => {
    const names: Record<string, string> = { 'ann@x.com': 'Ann Lee' }
    const nameOf = (user: string) => names[user] ?? user

    expect(commentExcerpt('Ask @[ann@x.com]\nabout   this', ['ann@x.com'], nameOf)).toBe(
      'Ask @Ann Lee about this',
    )
    expect(commentExcerpt('word '.repeat(30), [], nameOf)).toHaveLength(80)
    expect(commentExcerpt('word '.repeat(30), [], nameOf).endsWith('…')).toBe(true)
  })
})
