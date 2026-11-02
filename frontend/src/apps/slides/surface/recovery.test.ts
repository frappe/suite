import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearStaleRecovery,
  downloadRecovery,
  forgetRecovery,
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
    (copy.slides[0] as { clientId: string }).clientId,
    copy.sticky,
  ])
}

function downloadedFiles() {
  const created = vi.fn((_file: File) => 'blob:recovery')
  URL.createObjectURL = created as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = () => {}

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  return created
}

beforeEach(() => {
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

  it('removes only the unsticky copy once a save lands', () => {
    keepRecovery('node-1', [{ clientId: 'discarded' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'unload' }])

    clearStaleRecovery('node-1')

    expect(kept()).toEqual([['discarded', true]])
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

  it('downloads one file per click, newest first, until none is left', async () => {
    const files = downloadedFiles()
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'newer' }], { sticky: true })

    expect(downloadRecovery('node-1', 'Plan')).toBe(true)
    expect(kept()).toEqual([['older', true]])
    expect(JSON.parse(await files.mock.calls[0][0].text()).slides).toEqual([{ clientId: 'newer' }])

    expect(downloadRecovery('node-1', 'Plan')).toBe(true)
    expect(JSON.parse(await files.mock.calls[1][0].text()).slides).toEqual([{ clientId: 'older' }])

    expect(kept()).toEqual([])
    expect(downloadRecovery('node-1', 'Plan')).toBe(false)
  })

  it('removes the newest copy and leaves the older ones', () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'newer' }], { sticky: true })

    removeNewestRecovery('node-1')

    expect(kept()).toEqual([['older', true]])
  })

  it('forgets the copy holding exactly these slides', () => {
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true })
    keepRecovery('node-1', [{ clientId: 'held' }], { sticky: true })

    forgetRecovery('node-1', [{ clientId: 'held' }])

    expect(kept()).toEqual([['older', true]])
  })
})
