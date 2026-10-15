import { afterEach, describe, expect, it, vi } from 'vitest'

import { dropDraft, keepDraft, readDrafts } from './commentDrafts'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

function draft(clientId: string, text = '') {
  return { clientId, anchor: `anchor-${clientId}`, text }
}

describe('comment drafts on this device', () => {
  it('keeps several drafts of one document apart, each updated in place', () => {
    keepDraft('ann', 'doc-1', draft('one'))
    keepDraft('ann', 'doc-1', draft('two', 'second'))
    keepDraft('ann', 'doc-1', draft('one', 'first'))

    expect(readDrafts('ann', 'doc-1')).toEqual([draft('two', 'second'), draft('one', 'first')])
  })

  it("shows nobody else's drafts, nor another document's", () => {
    keepDraft('ann', 'doc-1', draft('one'))

    expect([readDrafts('bob', 'doc-1'), readDrafts('ann', 'doc-2')]).toEqual([[], []])
  })

  it('drops only the draft named', () => {
    keepDraft('ann', 'doc-1', draft('one'))
    keepDraft('ann', 'doc-1', draft('two'))

    dropDraft('ann', 'doc-1', 'one')

    expect(readDrafts('ann', 'doc-1')).toEqual([draft('two')])
  })

  it('keeps nothing, and never throws, when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    keepDraft('ann', 'doc-1', draft('one'))
    dropDraft('ann', 'doc-1', 'one')

    expect(readDrafts('ann', 'doc-1')).toEqual([])
  })

  it('reads a damaged entry as no drafts', () => {
    localStorage.setItem('suite:writer-comment-drafts:ann:doc-1', '{not json')
    localStorage.setItem('suite:writer-comment-drafts:ann:doc-2', '[{"clientId":1},"x"]')

    expect([readDrafts('ann', 'doc-1'), readDrafts('ann', 'doc-2')]).toEqual([[], []])
  })
})
