import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'

import type { Thread } from '@/apps/mail/types'

import { useRestoredRows } from './useRestoredRows'

const row = (id: string, at: string) => fromPartial<Thread>({ thread_id: id, received_at: at })
const ids = (rows: Thread[]) => rows.map((r) => r.thread_id)

const deferred = () => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const settle = () => new Promise((resolve) => setTimeout(resolve))

const setUp = () => {
  const folder = ref('inbox')
  const read = { current: deferred() }
  const restored = useRestoredRows({
    key: (thread) => thread.thread_id,
    scope: () => folder.value,
    reread: () => read.current.promise,
  })
  return { folder, read, ...restored }
}

// Pinned on top, so where a row stood is not where its date would put it.
const pinned = row('p', '2026-10-01')
const c = row('c', '2026-10-04')
const b = row('b', '2026-10-03')
const list = [pinned, c, b, row('a', '2026-10-02')]
const withoutCB = [pinned, list[3]]

describe('rows an Undo put back', () => {
  it('stay where they stood while the server lists them nowhere, until it does again', async () => {
    const { leaving, hold, withRestored, read } = setUp()
    leaving([c, b], list)
    const inverse = deferred()
    hold([c, b], inverse.promise)
    expect(ids(withRestored(withoutCB))).toEqual(['p', 'c', 'b', 'a'])

    // The undo landed, but the list is still being read again: they stay, or they would flicker.
    inverse.resolve()
    await settle()
    expect(ids(withRestored(withoutCB))).toEqual(['p', 'c', 'b', 'a'])

    read.current.resolve()
    await settle()
    expect(ids(withRestored(withoutCB))).toEqual(['p', 'a'])
  })

  it('go at once when the undo is refused', async () => {
    const { leaving, hold, withRestored } = setUp()
    leaving([c], list)
    const inverse = deferred()
    hold([c], inverse.promise)
    inverse.reject(new Error('Mail server is down'))
    await settle()
    expect(ids(withRestored(withoutCB))).toEqual(['p', 'a'])
  })

  it('go when an action takes them off the list again', () => {
    const { leaving, hold, withRestored } = setUp()
    leaving([c], list)
    hold([c], deferred().promise)
    leaving([c], withRestored(withoutCB))
    expect(ids(withRestored(withoutCB))).toEqual(['p', 'a'])
  })

  it('stay for a second Undo when the first one runs out under it', async () => {
    const { leaving, hold, withRestored, read } = setUp()
    leaving([c], list)
    const first = deferred()
    hold([c], first.promise)
    // Archived again and undone again before the first undo has been read back.
    leaving([c], withRestored(withoutCB))
    hold([c], deferred().promise)
    first.resolve()
    read.current.resolve()
    await settle()
    expect(ids(withRestored(withoutCB))).toEqual(['p', 'c', 'a'])
  })

  it('go with the list they were put back on', async () => {
    const { leaving, hold, withRestored, folder } = setUp()
    leaving([c], list)
    hold([c], deferred().promise)
    folder.value = 'archive'
    await nextTick()
    expect(ids(withRestored(withoutCB))).toEqual(['p', 'a'])
  })
})
