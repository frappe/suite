import { afterEach, describe, expect, it, vi } from 'vitest'

import { dropDraft, isDiscarded, keepDraft, readDrafts, removedElsewhere } from './commentDrafts'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

const KEY = 'suite:writer-comment-drafts:ann:doc-1'

function draft(clientId: string, text = '', isSent = false) {
  return { clientId, anchor: `anchor-${clientId}`, text, isSent }
}

function stored(storage: Storage) {
  return JSON.parse(storage.getItem(KEY) ?? 'null')
}

describe('comment drafts on this device', () => {
  it('keeps several drafts of one document apart, each updated in place', () => {
    keepDraft('ann', 'doc-1', draft('one'))
    keepDraft('ann', 'doc-1', draft('two', 'second'))
    keepDraft('ann', 'doc-1', draft('one', 'first'))

    expect(readDrafts('ann', 'doc-1')).toEqual([draft('two', 'second'), draft('one', 'first')])
  })

  it('keeps whether a draft was sent, and reads one kept before that was recorded as unsent', () => {
    keepDraft('ann', 'doc-1', draft('one', 'sent', true))
    const older = [{ clientId: 'two', anchor: 'anchor-two', text: 'older' }]
    localStorage.setItem('suite:writer-comment-drafts:ann:doc-2', JSON.stringify(older))

    expect([readDrafts('ann', 'doc-1'), readDrafts('ann', 'doc-2')]).toEqual([
      [draft('one', 'sent', true)],
      [draft('two', 'older')],
    ])
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

  it('keeps a box being typed in this tab only, and a sent draft on the device for every tab', () => {
    keepDraft('ann', 'doc-1', draft('one', 'typing'))
    keepDraft('ann', 'doc-1', draft('two', 'typed'))
    keepDraft('ann', 'doc-1', draft('two', 'sent', true))

    expect([stored(sessionStorage), stored(localStorage), readDrafts('ann', 'doc-1')]).toEqual([
      [draft('one', 'typing')],
      [draft('two', 'sent', true)],
      [draft('two', 'sent', true), draft('one', 'typing')],
    ])
  })

  it('shows a draft caught in both places while being sent once, as sent', () => {
    sessionStorage.setItem(KEY, JSON.stringify([draft('one', 'typing')]))
    localStorage.setItem(KEY, JSON.stringify([draft('one', 'sent', true)]))

    expect(readDrafts('ann', 'doc-1')).toEqual([draft('one', 'sent', true)])
  })

  it('keeps a box in this tab when the device copy of its sent words cannot be written', () => {
    keepDraft('ann', 'doc-1', draft('one', 'typing'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage) {
      if (this === localStorage) {
        throw new Error('full')
      }
    })

    keepDraft('ann', 'doc-1', draft('one', 'typing', true))

    expect(readDrafts('ann', 'doc-1')).toEqual([draft('one', 'typing')])
  })

  it('tells a draft gone from the device, and none while storage cannot be read', () => {
    keepDraft('ann', 'doc-1', draft('one', 'sent', true))
    keepDraft('ann', 'doc-1', draft('two', 'typing'))
    const found = ['one', 'two', 'three'].map((clientId) => isDiscarded('ann', 'doc-1', clientId))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect([found, isDiscarded('ann', 'doc-1', 'three')]).toEqual([[false, false, true], false])
  })

  it('reads a damaged entry as no drafts', () => {
    localStorage.setItem('suite:writer-comment-drafts:ann:doc-1', '{not json')
    localStorage.setItem('suite:writer-comment-drafts:ann:doc-2', '[{"clientId":1},"x"]')

    expect([readDrafts('ann', 'doc-1'), readDrafts('ann', 'doc-2')]).toEqual([[], []])
  })
})

describe('drafts another tab took out', () => {
  // The event a browser sends the other tabs when one changes the stored drafts
  function change(key: string, before: string[], after: string[]) {
    return new StorageEvent('storage', {
      key: `suite:writer-comment-drafts:${key}`,
      oldValue: JSON.stringify(before.map((clientId) => draft(clientId))),
      newValue: JSON.stringify(after.map((clientId) => draft(clientId))),
    })
  }

  it('names the drafts a change took out, not ones it kept or added', () => {
    const event = change('ann:doc-1', ['one', 'two'], ['two', 'three'])

    expect(removedElsewhere('ann', 'doc-1', event)).toEqual(new Set(['one']))
  })

  it("names none for a change to another document's or person's drafts", () => {
    const events = [change('ann:doc-2', ['one'], []), change('bob:doc-1', ['one'], [])]

    expect(events.map((event) => removedElsewhere('ann', 'doc-1', event))).toEqual([
      new Set(),
      new Set(),
    ])
  })
})
