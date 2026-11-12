import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  downloadRecovery,
  keepRecovery,
  readRecovery,
  recoveryFile,
  removeNewestRecovery,
} from './recovery'

function signIn(user: string) {
  const id = encodeURIComponent(user)
  document.cookie = `user_id=${id}`
}

function kept(node = 'node-1') {
  return readRecovery(node).map((copy) => [
    copy.slides[0] && typeof copy.slides[0] === 'object' && 'clientId' in copy.slides[0]
      ? copy.slides[0].clientId
      : undefined,
    copy.sticky,
  ])
}

function downloadedFiles() {
  const created = vi.fn((_file: File) => 'blob:recovery')
  URL.createObjectURL = fromPartial<typeof URL.createObjectURL>(created)
  URL.revokeObjectURL = () => {}

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  return created
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  signIn('me@example.com')
})

describe('Slides recovery copy', () => {
  it('keeps only the latest unsticky copy per presentation and reads it back', () => {
    keepRecovery('node-1', [{ clientId: 'a' }], { now: new Date('2026-09-30T10:00:00Z') })
    keepRecovery('node-1', [{ clientId: 'b' }], { now: new Date('2026-09-30T10:05:00Z') })

    expect(readRecovery('node-1')).toEqual([
      { savedAt: '2026-09-30T10:05:00.000Z', slides: [{ clientId: 'b' }], sticky: false },
    ])
    expect(readRecovery('node-2')).toEqual([])
  })

  it('reads nothing from a value it cannot parse', () => {
    localStorage.setItem('suite:slides-recovery:me@example.com:node-3', 'not json')
    expect(readRecovery('node-3')).toEqual([])
  })

  it('keeps a sticky copy when the unload guard writes over the unsticky one', () => {
    keepRecovery('node-1', [{ clientId: 'discarded' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'unload 1' }])
    keepRecovery('node-1', [{ clientId: 'unload 2' }])

    expect(kept()).toEqual([
      ['discarded', true],
      ['unload 2', false],
    ])
  })

  it('adds every different sticky copy and keeps what was there', () => {
    keepRecovery('node-1', [{ clientId: 'older' }])
    keepRecovery('node-1', [{ clientId: 'first' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'second' }], { sticky: true })

    expect(kept()).toEqual([
      ['older', false],
      ['first', true],
      ['second', true],
    ])
  })

  it('marks an identical copy sticky rather than adding it twice', () => {
    keepRecovery('node-1', [{ clientId: 'same' }])
    keepRecovery('node-1', [{ clientId: 'same' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'same' }], { sticky: true })

    expect(kept()).toEqual([['same', true]])
  })

  it('leaves a sticky copy alone when the unload guard holds the same slides', () => {
    keepRecovery('node-1', [{ clientId: 'same' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'same' }])

    expect(kept()).toEqual([['same', true]])
  })

  it('shows one person nothing another kept in the same browser', () => {
    keepRecovery('node-1', [{ clientId: 'mine' }], { sticky: true })

    signIn('other@example.com')
    expect(readRecovery('node-1')).toEqual([])

    keepRecovery('node-1', [{ clientId: 'theirs' }], { sticky: true })
    signIn('me@example.com')
    expect(kept()).toEqual([['mine', true]])
  })

  it('throws when the browser store is full, and keeps what it held', () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(() => keepRecovery('node-1', [{ clientId: 'new' }], { sticky: true })).toThrow()

    full.mockRestore()
    expect(kept()).toEqual([['older', true]])
  })

  it('offers a copy as a JSON file named after the presentation', async () => {
    const file = recoveryFile(
      {
        savedAt: '2026-09-30T10:05:00.000Z',
        slides: [{ clientId: 'a', elements: [] }],
        sticky: true,
      },
      'Q3 <review>',
    )

    expect(file.name).toBe('Q3 review (recovered).json')
    expect(JSON.parse(await file.text())).toEqual({
      title: 'Q3 <review>',
      recoveredAt: '2026-09-30T10:05:00.000Z',
      slides: [{ clientId: 'a', elements: [] }],
    })
  })

  it('gives the next older copy per click and removes none, then the newest again', async () => {
    const files = downloadedFiles()
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'newer' }], { sticky: true })

    async function downloaded() {
      expect(downloadRecovery('node-1', 'Plan')).toBe(true)
      const file = files.mock.lastCall?.[0]
      if (!(file instanceof File)) throw new Error('Expected a downloaded recovery file')
      return JSON.parse(await file.text()).slides
    }

    expect(await downloaded()).toEqual([{ clientId: 'newer' }])
    expect(await downloaded()).toEqual([{ clientId: 'older' }])
    expect(await downloaded()).toEqual([{ clientId: 'newer' }])
    expect(await downloaded()).toEqual([{ clientId: 'newer' }])
    expect(kept()).toEqual([
      ['older', true],
      ['newer', true],
    ])
  })

  it('has nothing to download with no copy kept', () => {
    expect(downloadRecovery('node-1', 'Plan')).toBe(false)
  })

  it('counts the download when the store is too full to mark it', () => {
    const files = downloadedFiles()
    keepRecovery('node-1', [{ clientId: 'kept' }], { sticky: true })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(downloadRecovery('node-1', 'Plan')).toBe(true)

    expect(files).toHaveBeenCalledTimes(1)
    expect(kept()).toEqual([['kept', true]])
  })

  it('moves an identical copy to the end, newly dated, with its download remembered', () => {
    downloadedFiles()
    keepRecovery('node-1', [{ clientId: 'same' }], { now: new Date('2026-09-30T10:00:00Z') })
    downloadRecovery('node-1', 'Plan')
    keepRecovery('node-1', [{ clientId: 'other' }], {
      sticky: true,
      now: new Date('2026-09-30T10:05:00Z'),
    })
    keepRecovery('node-1', [{ clientId: 'same' }], {
      sticky: true,
      now: new Date('2026-09-30T10:10:00Z'),
    })

    expect(readRecovery('node-1')).toEqual([
      { savedAt: '2026-09-30T10:05:00.000Z', slides: [{ clientId: 'other' }], sticky: true },
      {
        savedAt: '2026-09-30T10:10:00.000Z',
        slides: [{ clientId: 'same' }],
        sticky: true,
        downloaded: true,
      },
    ])
  })

  it('removes the newest copy and leaves the older ones', () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'newer' }], { sticky: true })

    removeNewestRecovery('node-1')

    expect(kept()).toEqual([['older', true]])
  })
})
