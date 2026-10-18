import { describe, expect, it } from 'vitest'

import type { DocumentThread } from '@/apps/drive'
import type { ThreadPlace } from '@/apps/writer/collab/places'

import { threadRows } from './threadRows'

function thread(name: string) {
  return { name } as DocumentThread
}

function shown(rows: ReturnType<typeof threadRows>) {
  return rows.map((row) => `${row.thread.name} [${row.where}] "${row.quote}"`)
}

describe('thread rows in the comments panel', () => {
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

    expect(shown(threadRows(threads, places))).toEqual([
      'whole [] ""',
      'earlier [] "earlier"',
      'later [] "later"',
      'coming [] "new words"',
      'old [] ""',
      'gone [Text deleted] "old words"',
    ])
  })

  it('shows a thread the editor has not placed yet with the threads on text', () => {
    const places = new Map<string, ThreadPlace>([
      ['deleted', { kind: 'deleted', quote: 'gone' }],
      ['whole', { kind: 'document' }],
    ])

    expect(shown(threadRows([thread('deleted'), thread('new'), thread('whole')], places))).toEqual([
      'whole [] ""',
      'new [] ""',
      'deleted [Text deleted] "gone"',
    ])
  })

  it("keeps Drive's order with no place words when the editor places none", () => {
    expect(shown(threadRows([thread('one'), thread('two')], null))).toEqual([
      'one [] ""',
      'two [] ""',
    ])
  })
})
