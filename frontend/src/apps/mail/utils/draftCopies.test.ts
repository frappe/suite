import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearDraftCopies,
  DRAFT_COPY_MAX_AGE_MS,
  findDraftCopy,
  heldDraftCopyKeys,
  listDraftCopies,
  removeDraftCopy,
  writeDraftCopy,
  type DraftCopy,
} from './draftCopies'

const copy = (over: Partial<DraftCopy> = {}): DraftCopy => ({
  key: 'k1',
  user: 'maya@example.com',
  account: 'a1',
  ids: ['draft-2', 'draft-1'],
  savedAt: Date.now(),
  uploading: [],
  mail: {
    to: [],
    cc: [],
    bcc: [],
    subject: 'Hello',
    html_body: '<p>Hi</p>',
    quoted_content: '',
    attachments: [],
    in_reply_to: '',
    in_reply_to_id: '',
    forwarded_from_id: '',
  },
  ...over,
})

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('draft copies', () => {
  it('finds a copy by any id the draft has had', () => {
    writeDraftCopy(copy())
    expect(findDraftCopy('maya@example.com', 'a1', 'draft-1')?.key).toBe('k1')
    expect(findDraftCopy('maya@example.com', 'a1', 'draft-2')?.key).toBe('k1')
    expect(findDraftCopy('maya@example.com', 'a1', 'draft-3')).toBeUndefined()
  })

  it('keeps people and accounts apart', () => {
    writeDraftCopy(copy())
    writeDraftCopy(copy({ user: 'sam@example.com' }))
    writeDraftCopy(copy({ key: 'k2', account: 'a2' }))
    expect(listDraftCopies('maya@example.com').map((c) => c.key)).toHaveLength(2)
    expect(listDraftCopies('sam@example.com')).toHaveLength(1)
    expect(findDraftCopy('maya@example.com', 'a3', 'draft-1')).toBeUndefined()

    removeDraftCopy('maya@example.com', 'a1', 'k1')
    expect(listDraftCopies('maya@example.com').map((c) => c.key)).toEqual(['k2'])
    expect(listDraftCopies('sam@example.com')).toHaveLength(1)
  })

  it('does not treat a user whose name starts with another as that one', () => {
    writeDraftCopy(copy({ user: 'maya@example.com.au' }))
    expect(listDraftCopies('maya@example.com')).toEqual([])
  })

  it('lists newest first', () => {
    writeDraftCopy(copy({ key: 'old', savedAt: 1000 + Date.now() - 5000 }))
    writeDraftCopy(copy({ key: 'new' }))
    expect(listDraftCopies('maya@example.com').map((c) => c.key)).toEqual(['new', 'old'])
  })

  it('lets a copy go once it is too old, whoever it belongs to', () => {
    const now = Date.now()
    writeDraftCopy(copy({ savedAt: now - DRAFT_COPY_MAX_AGE_MS - 1 }))
    writeDraftCopy(copy({ key: 'fresh', savedAt: now - DRAFT_COPY_MAX_AGE_MS + 1000 }))
    writeDraftCopy(copy({ key: 'theirs', user: 's', savedAt: now - DRAFT_COPY_MAX_AGE_MS - 1 }))

    expect(listDraftCopies('maya@example.com', now).map((c) => c.key)).toEqual(['fresh'])
    expect(Object.keys(localStorage)).toHaveLength(1)
  })

  it('discards what it cannot read', () => {
    localStorage.setItem('suite.mail.draftCopy.v1:maya%40example.com:a1:bad', '{not json')
    expect(listDraftCopies('maya@example.com')).toEqual([])
    expect(localStorage.length).toBe(0)
  })

  it('clears only the person signing out', () => {
    writeDraftCopy(copy())
    writeDraftCopy(copy({ key: 'k2', account: 'a2' }))
    writeDraftCopy(copy({ user: 'sam@example.com' }))
    clearDraftCopies('maya@example.com')
    expect(listDraftCopies('maya@example.com')).toEqual([])
    expect(listDraftCopies('sam@example.com')).toHaveLength(1)
  })

  it('reports failure rather than throwing when storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError')
    })
    expect(writeDraftCopy(copy())).toBe(false)
  })

  it('does not throw anywhere when storage is blocked outright', () => {
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    expect(writeDraftCopy(copy())).toBe(false)
    expect(listDraftCopies('maya@example.com')).toEqual([])
    expect(findDraftCopy('maya@example.com', 'a1', 'draft-1')).toBeUndefined()
    expect(() => removeDraftCopy('maya@example.com', 'a1', 'k1')).not.toThrow()
    expect(() => clearDraftCopies('maya@example.com')).not.toThrow()
    blocked.mockRestore()
  })

  it('reads which copies live composers hold, and none without Web Locks', async () => {
    vi.stubGlobal('navigator', {
      locks: {
        query: async () => ({
          held: [{ name: 'suite.mail.draftCopy.v1:k1' }, { name: 'something-else' }],
        }),
      },
    })
    expect(await heldDraftCopyKeys()).toEqual(new Set(['k1']))
    vi.stubGlobal('navigator', {})
    expect(await heldDraftCopyKeys()).toEqual(new Set())
    vi.unstubAllGlobals()
  })
})
