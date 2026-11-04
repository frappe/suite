import { describe, expect, it } from 'vitest'

import { readOldThreads } from '@/apps/writer/collab/old-threads'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ANN = { userName: 'Ann', userImage: null, time: 1700000000000, content: 'see' }
const BO = { userName: 'Bo', userImage: null, time: 1700000060000, content: 'agreed' }

function thread(uuid: unknown, comments: unknown) {
  return JSON.stringify({ uuid, comments })
}

describe('readOldThreads', () => {
  it('reads a thread under a fresh key, with each comment in order', () => {
    const text = thread('u1', [ANN, BO])

    const read = readOldThreads([text])!

    expect(read.threads).toEqual([
      {
        key: expect.stringMatching(V4),
        comments: [
          { content: 'see', authorName: 'Ann', time: 1700000000000 },
          { content: 'agreed', authorName: 'Bo', time: 1700000060000 },
        ],
      },
    ])
    expect(read.threads[0].key).not.toBe('u1')
    expect([...read.keyOf]).toEqual([[text, read.threads[0].key]])
    expect(read.hasImages).toBe(false)
  })

  it('reads a comment list kept as JSON text', () => {
    const read = readOldThreads([thread('u1', JSON.stringify([ANN]))])!

    expect(read.threads.map(({ comments }) => comments)).toEqual([
      [{ content: 'see', authorName: 'Ann', time: 1700000000000 }],
    ])
  })

  it("keeps the longest list when a reply rewrote only some of a thread's marks", () => {
    const before = thread('u1', [ANN])
    const after = thread('u1', [ANN, BO])

    const read = readOldThreads([before, after, before])!

    expect(
      read.threads.map(({ comments }) => comments.map(({ authorName }) => authorName)),
    ).toEqual([['Ann', 'Bo']])
    expect(read.keyOf.get(before)).toBe(read.keyOf.get(after))
  })

  it('gives two threads two keys', () => {
    const read = readOldThreads([thread('u1', [ANN]), thread('u2', [BO])])!

    const [one, two] = read.threads.map(({ key }) => key)
    expect([read.threads.length, one === two]).toEqual([2, false])
  })

  it('reads nothing from no marks', () => {
    expect(readOldThreads([])).toEqual({ keyOf: new Map(), threads: [], hasImages: false })
  })

  it.each([
    { name: 'a picture link', image: '/files/ann.png', hasImages: true },
    { name: 'an empty picture link', image: '', hasImages: false },
    { name: 'no picture key', image: undefined, hasImages: false },
  ])('notes whether a comment held $name', ({ image, hasImages }) => {
    const read = readOldThreads([thread('u1', [{ ...ANN, userImage: image }])])!

    expect(read.hasImages).toBe(hasImages)
  })

  it.each([
    {
      name: 'a later comment',
      lists: [
        [ANN, BO],
        [ANN, { ...BO, content: 'no' }],
      ],
    },
    { name: 'the first comment', lists: [[ANN], [{ ...ANN, content: 'saw' }, BO]] },
    { name: 'a time', lists: [[ANN], [{ ...ANN, time: 1700000000001 }, BO]] },
    { name: 'a name', lists: [[ANN], [{ ...ANN, userName: 'Anna' }, BO]] },
    { name: 'a picture', lists: [[ANN], [{ ...ANN, userImage: '/files/ann.png' }, BO]] },
  ])("reads none when two of one thread's lists part ways at $name", ({ lists }) => {
    expect(readOldThreads(lists.map((list) => thread('u1', list)))).toBeNull()
  })

  it.each([
    { name: 'a blank text', content: ' \n\u00a0' },
    { name: 'a text Python reads as blank', content: '\x1c\u2028' },
    { name: 'an empty text', content: '' },
    { name: 'a text over 65,535 bytes', content: '\u00e9'.repeat(32768) },
    { name: 'a lone surrogate', content: 'see \ud800' },
    { name: 'a number for its text', content: 7 },
    { name: 'no text', content: undefined },
  ])('reads none from a comment with $name', ({ content }) => {
    expect(readOldThreads([thread('u1', [{ ...ANN, content }])])).toBeNull()
  })

  it.each([
    { name: 'a text of 65,535 bytes', fields: { content: 'a'.repeat(65535) } },
    { name: 'a time of 0', fields: { time: 0 } },
    { name: 'the last time before the year 10000', fields: { time: Date.UTC(10000, 0, 1) - 1 } },
    {
      name: 'a name of 140 characters drawn as two code units each',
      fields: { userName: '\u{1f600}'.repeat(140) },
    },
  ])('reads a comment with $name', ({ fields }) => {
    expect(readOldThreads([thread('u1', [{ ...ANN, ...fields }])])).not.toBeNull()
  })

  it.each([
    { name: 'no name', fields: { userName: undefined } },
    { name: 'a blank name', fields: { userName: '  ' } },
    { name: 'a name of 141 characters', fields: { userName: '\u{1f600}'.repeat(141) } },
    { name: 'a lone surrogate in its name', fields: { userName: '\udc00' } },
    { name: 'no time', fields: { time: undefined } },
    { name: 'a time before 1970', fields: { time: -1 } },
    { name: 'a time in the year 10000', fields: { time: Date.UTC(10000, 0, 1) } },
    { name: 'a time as text', fields: { time: '1700000000000' } },
    { name: 'a number for its picture', fields: { userImage: 7 } },
    { name: 'an unknown key', fields: { resolved: true } },
  ])('reads none from a comment with $name', ({ fields }) => {
    expect(readOldThreads([thread('u1', [{ ...ANN, ...fields }])])).toBeNull()
  })

  it.each([
    { name: "text that isn't JSON", text: '{"uuid":' },
    { name: 'a list for a thread', text: JSON.stringify([ANN]) },
    { name: 'no comments', text: thread('u1', []) },
    { name: "comments that aren't a list", text: thread('u1', ANN) },
    { name: "a comment list in text that isn't JSON", text: thread('u1', '[') },
    { name: "a comment that isn't an object", text: thread('u1', ['see']) },
    { name: 'an empty id', text: thread('', [ANN]) },
    { name: 'a number for its id', text: thread(1, [ANN]) },
    { name: 'an unknown key', text: JSON.stringify({ uuid: 'u1', comments: [ANN], x: 1 }) },
  ])('reads none from a thread with $name', ({ text }) => {
    expect(readOldThreads([text])).toBeNull()
  })

  it("reads none when one of several marks can't be read", () => {
    expect(readOldThreads([thread('u1', [ANN]), thread('u2', [])])).toBeNull()
  })
})
