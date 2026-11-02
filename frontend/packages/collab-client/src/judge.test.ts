import { describe, expect, it } from 'vitest'
import * as yjs from 'yjs'

import { judge } from './judge'

const garbage = new Uint8Array([255, 255, 255])

function typing(...words: string[]) {
  const doc = new yjs.Doc()
  const rows: Uint8Array[] = []
  doc.on('update', (bytes: Uint8Array) => rows.push(bytes))
  const text = doc.getText('t')
  for (const word of words) {
    text.insert(text.length, word)
  }

  return rows
}

function rejectsBad(doc: yjs.Doc) {
  return doc.getText('t').toString().includes('bad') ? 'has bad' : null
}

function neverFaults() {
  return null
}

function releaseNothing() {}

describe('judge', () => {
  it('passes rows that apply and satisfy the fault check', () => {
    expect(judge(null, typing('a', 'b', 'c'), rejectsBad, releaseNothing)).toEqual({
      verdict: 'clean',
    })
  })

  it('names the first row that throws, even with good rows after it', () => {
    const rows = typing('a', 'b', 'c', 'd', 'e')
    rows.splice(2, 0, garbage)
    expect(judge(null, rows, neverFaults, releaseNothing)).toMatchObject({
      verdict: 'bad',
      index: 2,
    })
  })

  it('names the first row the fault check refuses', () => {
    const rows = typing('a', 'b', 'c', 'bad', 'e', 'f', 'g')
    expect(judge(null, rows, rejectsBad, releaseNothing)).toEqual({
      verdict: 'bad',
      index: 3,
      reason: 'has bad',
    })
  })

  it('names the last row when only it is bad', () => {
    expect(judge(null, typing('a', 'bad'), rejectsBad, releaseNothing)).toEqual({
      verdict: 'bad',
      index: 1,
      reason: 'has bad',
    })
  })

  it('blames the checkpoint when it is already bad', () => {
    expect(judge(garbage, typing('a'), neverFaults, releaseNothing)).toMatchObject({
      verdict: 'bad',
      index: -1,
    })
  })

  it('judges rows on top of the checkpoint', () => {
    const [first, ...rest] = typing('bad', 'b')
    expect(judge(first, rest, rejectsBad, releaseNothing)).toEqual({
      verdict: 'bad',
      index: -1,
      reason: 'has bad',
    })
  })
})
