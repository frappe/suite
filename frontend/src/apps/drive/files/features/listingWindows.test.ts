import { describe, expect, it } from 'vitest'
import { loadUntilVisible, type WindowResult } from './listingWindows'

function windows(pages: Array<{ rows: string[]; hasNext: boolean }>) {
  let index = 0
  let accumulated: string[] = []
  let hasNext = true
  const result: WindowResult = {
    get rows() { return accumulated },
    get hasNext() { return hasNext },
    async fetchNext() {
      const page = pages[index++]!
      accumulated = [...accumulated, ...page.rows]
      hasNext = page.hasNext
      return result
    },
  }
  return result
}

describe('listing cursor windows', () => {
  it('continues after a short window when the cursor exists', async () => {
    const result = windows([{ rows: ['a'], hasNext: true }])
    expect((await loadUntilVisible(result)).rows).toEqual(['a'])
  })

  it('skips empty permission-filtered windows', async () => {
    const result = windows([
      { rows: [], hasNext: true },
      { rows: ['visible'], hasNext: false },
    ])
    expect((await loadUntilVisible(result)).rows).toEqual(['visible'])
  })
})
