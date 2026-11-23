import { beforeEach, describe, expect, it } from 'vitest'

import { createCommentsEngine } from './comments.js'

const reply = (text, extra = {}) => ({ author: 'a@x.com', name: 'Ann', text, ts: 1000, ...extra })

describe('CommentsEngine — threads', () => {
  let c
  beforeEach(() => {
    c = createCommentsEngine()
  })

  it('addReply creates a thread', () => {
    c.addReply('A1', reply('hello'), 'Sheet1')
    expect(c.getThread('A1', 'Sheet1')).toEqual({
      resolved: false,
      thread: [{ author: 'a@x.com', name: 'Ann', text: 'hello', ts: 1000 }],
    })
  })

  it('a second reply appends to the same thread', () => {
    c.addReply('A1', reply('one'), 'Sheet1')
    c.addReply('A1', reply('two', { author: 'b@x.com', name: 'Bob' }), 'Sheet1')
    const t = c.getThread('A1', 'Sheet1')
    expect(t.thread.map((r) => r.text)).toEqual(['one', 'two'])
  })

  it('blank reply is ignored', () => {
    c.addReply('A1', reply('   '), 'Sheet1')
    expect(c.getThread('A1', 'Sheet1')).toBeNull()
  })

  it('missing thread is null', () => {
    expect(c.getThread('Z9', 'Sheet1')).toBeNull()
  })

  it('stores mentions only when present', () => {
    c.addReply('A1', reply('hi @Bob', { mentions: ['b@x.com'] }), 'Sheet1')
    expect(c.getThread('A1', 'Sheet1').thread[0].mentions).toEqual(['b@x.com'])
    c.addReply('A2', reply('plain'), 'Sheet1')
    expect('mentions' in c.getThread('A2', 'Sheet1').thread[0]).toBe(false)
  })

  it('resolve toggles, and a new reply reopens', () => {
    c.addReply('A1', reply('q'), 'Sheet1')
    c.resolve('A1', true, 'Sheet1')
    expect(c.getThread('A1', 'Sheet1').resolved).toBe(true)
    expect(c.hasOpenComment('A1', 'Sheet1')).toBe(false)
    c.addReply('A1', reply('answer'), 'Sheet1')
    expect(c.getThread('A1', 'Sheet1').resolved).toBe(false) // reopened
    expect(c.hasOpenComment('A1', 'Sheet1')).toBe(true)
  })

  it('a resolved thread stops marking the cell (hasOpenComment false)', () => {
    c.addReply('A1', reply('x'), 'Sheet1')
    c.resolve('A1', true, 'Sheet1')
    expect(c.hasOpenComment('A1', 'Sheet1')).toBe(false)
    expect(c.getThread('A1', 'Sheet1')).not.toBeNull() // still exists, just resolved
  })

  it('removeReply drops one; removing the last drops the thread', () => {
    c.addReply('A1', reply('one'), 'Sheet1')
    c.addReply('A1', reply('two'), 'Sheet1')
    c.removeReply('A1', 0, 'Sheet1')
    expect(c.getThread('A1', 'Sheet1').thread.map((r) => r.text)).toEqual(['two'])
    c.removeReply('A1', 0, 'Sheet1')
    expect(c.getThread('A1', 'Sheet1')).toBeNull()
  })

  it('mutations replace the object — a captured reference stays frozen', () => {
    c.addReply('A1', reply('one'), 'Sheet1')
    const before = c.getThread('A1', 'Sheet1') // capture the current state
    c.addReply('A1', reply('two'), 'Sheet1')
    c.resolve('A1', true, 'Sheet1')
    expect(before.thread).toHaveLength(1) // frozen: not appended to
    expect(before.resolved).toBe(false) // frozen: not flipped
    expect(c.getThread('A1', 'Sheet1').thread).toHaveLength(2)
    expect(c.getThread('A1', 'Sheet1').resolved).toBe(true)
  })

  it('preview is the first reply text', () => {
    c.addReply('A1', reply('first'), 'Sheet1')
    c.addReply('A1', reply('second'), 'Sheet1')
    expect(c.preview('A1', 'Sheet1')).toBe('first')
  })

  it('clear removes the thread', () => {
    c.addReply('A1', reply('x'), 'Sheet1')
    c.clear('A1', 'Sheet1')
    expect(c.getThread('A1', 'Sheet1')).toBeNull()
  })

  it('setThread stores an isolated copy — no aliasing with the caller', () => {
    const src = { resolved: false, thread: [{ text: 'x' }] }
    c.setThread('A1', src, 'Sheet1')
    src.thread.push({ text: 'leak' }) // mutate the caller's object afterwards
    src.resolved = true
    expect(c.getThread('A1', 'Sheet1').thread).toHaveLength(1)
    expect(c.getThread('A1', 'Sheet1').resolved).toBe(false)
  })
})

describe('CommentsEngine — legacy migration', () => {
  let c
  beforeEach(() => {
    c = createCommentsEngine()
  })

  it('restore upgrades a flat-string note to a one-entry thread', () => {
    c.restore({ Sheet1: { A1: 'old note', B2: '  ' } })
    expect(c.getThread('A1', 'Sheet1')).toEqual({
      resolved: false,
      thread: [{ author: '', name: '', text: 'old note', ts: null }],
    })
    expect(c.getThread('B2', 'Sheet1')).toBeNull() // blank legacy note dropped
  })

  it('a string that slips into the store is migrated in place on read', () => {
    c.restore({ Sheet1: { A1: { resolved: false, thread: [{ text: 't' }] } } })
    const t = c.getThread('A1', 'Sheet1')
    expect(t.thread[0].text).toBe('t')
  })

  it('drops corrupt non-string, non-thread values instead of crashing', () => {
    c.restore({
      Sheet1: {
        A1: 5,
        B2: [1, 2],
        C3: { nope: true },
        D4: { resolved: false, thread: [{ text: 'ok' }] },
      },
    })
    expect(c.getThread('A1', 'Sheet1')).toBeNull()
    expect(c.getThread('B2', 'Sheet1')).toBeNull()
    expect(c.getThread('C3', 'Sheet1')).toBeNull()
    expect(c.preview('D4', 'Sheet1')).toBe('ok') // valid thread survives
    expect(c.hasOpenComment('A1', 'Sheet1')).toBe(false) // no crash on the dropped ones
  })
})

describe('CommentsEngine — shifts, lifecycle, snapshot', () => {
  let c
  beforeEach(() => {
    c = createCommentsEngine()
  })

  it('insertRow shifts threads down', () => {
    c.addReply('A2', reply('note'), 'Sheet1')
    c.insertRow(1, 'Sheet1')
    expect(c.preview('A3', 'Sheet1')).toBe('note')
    expect(c.getThread('A2', 'Sheet1')).toBeNull()
  })

  it('deleteRow removes the deleted row and shifts up', () => {
    c.addReply('A1', reply('first'), 'Sheet1')
    c.addReply('A2', reply('second'), 'Sheet1')
    c.deleteRow(0, 'Sheet1')
    expect(c.preview('A1', 'Sheet1')).toBe('second')
    expect(c.getThread('A2', 'Sheet1')).toBeNull()
  })

  it('snapshot/restore round-trips a thread', () => {
    c.addReply('A1', reply('x'), 'Sheet1')
    c.resolve('A1', true, 'Sheet1')
    const snap = c.snapshot()
    const c2 = createCommentsEngine()
    c2.restore(snap)
    expect(c2.getThread('A1', 'Sheet1').resolved).toBe(true)
    expect(c2.preview('A1', 'Sheet1')).toBe('x')
  })

  it('restore isolates the live store from the snapshot (in-place edits keep history intact)', () => {
    c.addReply('A1', reply('one'), 'Sheet1')
    const snap = c.snapshot() // deep copy of the store
    c.restore(snap) // navigate back to it
    c.addReply('A1', reply('two'), 'Sheet1') // then edit the live thread in place
    expect(snap.Sheet1.A1.thread).toHaveLength(1) // the history entry must be untouched
    expect(c.getThread('A1', 'Sheet1').thread).toHaveLength(2)
  })

  it('duplicate deep-copies threads', () => {
    c.addReply('A1', reply('x'), 'S1')
    c.duplicateSheet('S1', 'S1 copy')
    c.clear('A1', 'S1')
    expect(c.preview('A1', 'S1 copy')).toBe('x')
  })
})
