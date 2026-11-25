import { describe, expect, it, vi } from 'vitest'

import { afterUndoing, undoOnClick } from '@/apps/mail/utils'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}
const flush = () => new Promise((r) => setTimeout(r))

describe('afterUndoing', () => {
  it('holds a new write behind every Undo still waiting, not only the latest', async () => {
    const archive = deferred()
    const trash = deferred()
    const sent: string[] = []
    const inverse = (name: string) => () => (sent.push(name), Promise.resolve())

    undoOnClick(archive.promise, () => {}, inverse('unarchive'))()
    undoOnClick(trash.promise, () => {}, inverse('untrash'))()
    trash.resolve()
    await flush()
    void afterUndoing(() => (sent.push('move'), Promise.resolve()))
    await flush()
    expect(sent).toEqual(['untrash'])

    archive.resolve()
    await flush()
    expect(sent).toEqual(['untrash', 'unarchive', 'move'])
  })

  it('lets later writes through once a waiting Undo is refused', async () => {
    const archive = deferred()
    const send = vi.fn(() => Promise.resolve())
    undoOnClick(
      archive.promise,
      (inverted) => void inverted.catch(() => {}),
      () => Promise.reject(new Error('refused')),
    )()
    void afterUndoing(send)
    await flush()
    expect(send).not.toHaveBeenCalled()

    archive.resolve()
    await flush()
    expect(send).toHaveBeenCalledOnce()
  })
})
