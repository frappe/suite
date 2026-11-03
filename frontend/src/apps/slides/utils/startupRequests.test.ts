import { describe, expect, it } from 'vitest'

import { runPool } from './startupRequests'

function held() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('runPool', () => {
  it('takes no more items after a failure', async () => {
    const started: number[] = []

    await expect(
      runPool([1, 2, 3, 4, 5, 6, 7, 8], async (item) => {
        started.push(item)
        if (item === 1) {
          throw new Error('one')
        }
      }),
    ).rejects.toThrow('one')

    expect(started).toEqual([1, 2, 3, 4])
  })

  it('answers only once the lanes still working have finished', async () => {
    const slow = held()
    let hasAnswered = false
    async function run() {
      const pool = runPool([1, 2], async (item) => {
        if (item === 1) {
          throw new Error('one')
        }

        await slow.promise
      })
      await expect(pool).rejects.toThrow('one')
      hasAnswered = true
    }

    const running = run()
    for (let turn = 0; turn < 50; turn++) {
      await Promise.resolve()
    }

    expect(hasAnswered).toBe(false)

    slow.release()
    await running
    expect(hasAnswered).toBe(true)
  })

  it('rethrows the failure that came first', async () => {
    const later = held()

    const pool = runPool([1, 2], async (item) => {
      if (item === 1) {
        await later.promise
        throw new Error('later')
      }

      later.release()
      throw new Error('first')
    })

    await expect(pool).rejects.toThrow('first')
  })
})
