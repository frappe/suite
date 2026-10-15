import { describe, expect, it } from 'vitest'

import type { DocumentThread } from '@/apps/drive'
import type { ThreadPlace } from '@/apps/writer/collab/places'

import { groupThreads } from './threadGroups'

function thread(name: string) {
  return { name } as DocumentThread
}

function shown(groups: ReturnType<typeof groupThreads>) {
  return groups.map((group) => {
    const entries = group.threads.map((entry) => `${entry.thread.name} "${entry.quote}"`)
    return [group.title, entries]
  })
}

describe('comment groups in the panel', () => {
  it('lists document comments first, threads on text in reading order, and deleted text last', () => {
    const places = new Map<string, ThreadPlace>([
      ['gone', { kind: 'deleted', quote: 'old words' }],
      ['later', { kind: 'text', from: 40, to: 45, quote: 'later' }],
      ['coming', { kind: 'arriving', quote: 'new words' }],
      ['old', { kind: 'unplaced' }],
      ['earlier', { kind: 'text', from: 3, to: 9, quote: 'earlier' }],
      ['whole', { kind: 'document' }],
    ])
    const threads = ['gone', 'later', 'coming', 'old', 'earlier', 'whole'].map(thread)

    expect(shown(groupThreads(threads, places))).toEqual([
      ['Comments on the document', ['whole ""']],
      ['On the text', ['earlier "earlier"', 'later "later"', 'coming "new words"']],
      ['Not attached to text', ['old ""']],
      ['Original text deleted', ['gone "old words"']],
    ])
  })

  it('shows a thread the editor has not placed yet with the threads on text', () => {
    const places = new Map<string, ThreadPlace>([['whole', { kind: 'document' }]])

    expect(shown(groupThreads([thread('whole'), thread('new')], places))).toEqual([
      ['Comments on the document', ['whole ""']],
      ['On the text', ['new ""']],
    ])
  })

  it('lists every thread in one untitled run when the editor places none', () => {
    expect(shown(groupThreads([thread('one'), thread('two')], null))).toEqual([
      ['', ['one ""', 'two ""']],
    ])
    expect(groupThreads([], null)).toEqual([])
  })
})
