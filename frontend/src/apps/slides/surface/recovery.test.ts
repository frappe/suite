import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  discardRecovery,
  downloadRecovery,
  keepOutlivedRecovery,
  keepRecovery,
  readRecovery,
  recoveryFile,
  recoveryRecords,
  removeNewestRecovery,
} from './recovery'

const PREFIX = 'suite:slides-recovery:me@example.com:'

// Another tab of this browser: the same storage, its own page load
async function otherTab() {
  vi.resetModules()
  return import('./recovery')
}

function clientIds(node = 'node-1') {
  // SAFETY: each copy these tests keep starts with a slide that has a clientId
  return readRecovery(node).map((copy) => (copy.slides[0] as { clientId: string }).clientId)
}

function recordKey(node: string, clientId: string) {
  const record = recoveryRecords(node).find(
    // SAFETY: each copy these tests keep starts with a slide that has a clientId
    ({ copy }) => (copy.slides[0] as { clientId: string }).clientId === clientId,
  )
  if (!record) throw new Error(`no record holds ${clientId}`)
  return `${PREFIX}${node}:${record.id}`
}

// What an action writes or removes, by key
function touchedKeys(run: () => void) {
  const touched: string[] = []
  const { setItem, removeItem } = Storage.prototype
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    touched.push(`set ${key}`)
    setItem.call(this, key, value)
  })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    touched.push(`remove ${key}`)
    removeItem.call(this, key)
  })
  run()
  vi.restoreAllMocks()
  return touched
}

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

  it('keeps an earlier page copy past every later copy when the store was too full to mark it', () => {
    // a copy from before the sticky marker, and a store too full to add it
    localStorage.setItem(
      'suite:slides-recovery:me@example.com:node-full',
      JSON.stringify([{ savedAt: '2026-09-30T10:00:00.000Z', slides: [{ clientId: 'unsent' }] }]),
    )
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    keepOutlivedRecovery('node-full', [{ clientId: 'shown' }])

    keepRecovery('node-full', [{ clientId: 'later' }])
    keepRecovery('node-full', [{ clientId: 'latest' }])

    expect(kept('node-full').map(([clientId]) => clientId)).toEqual(['unsent', 'latest'])
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

describe('Slides recovery copies across tabs', () => {
  const at = (minute: number) => ({ now: new Date(Date.UTC(2026, 10, 12, 10, minute)) })

  it('drops no copy another tab kept, whatever order the tabs keep in', async () => {
    const tabB = await otherTab()

    tabB.keepRecovery('node-1', [{ clientId: 'b sticky' }], { sticky: true, ...at(1) })
    keepRecovery('node-1', [{ clientId: 'a unsent' }], at(2))
    tabB.keepRecovery('node-1', [{ clientId: 'b unsent' }], at(3))
    keepRecovery('node-1', [{ clientId: 'a sticky' }], { sticky: true, ...at(4) })
    keepRecovery('node-1', [{ clientId: 'a unsent again' }], at(5))

    expect(clientIds()).toEqual(['b sticky', 'b unsent', 'a sticky', 'a unsent again'])
  })

  it('reads an older single list as its copies, then keeps each on its own', () => {
    localStorage.setItem(
      `${PREFIX}node-1`,
      JSON.stringify([
        { savedAt: '2026-09-30T10:00:00.000Z', slides: [{ clientId: 'old' }] },
        { savedAt: '2026-09-30T10:05:00.000Z', slides: [{ clientId: 'old sticky' }], sticky: true },
      ]),
    )

    expect(kept()).toEqual([
      ['old', undefined],
      ['old sticky', true],
    ])
    expect(localStorage.getItem(`${PREFIX}node-1`)).toBeNull()

    const old = recoveryRecords('node-1').find(({ copy }) => !copy.sticky)!
    discardRecovery('node-1', old.id, old.copy)
    expect(kept()).toEqual([['old sticky', true]])
  })

  it('reads an older list written again after it was split as the same copies, once', () => {
    const list = JSON.stringify([
      { savedAt: '2026-09-30T10:00:00.000Z', slides: [{ clientId: 'old' }], sticky: true },
    ])
    localStorage.setItem(`${PREFIX}node-1`, list)
    readRecovery('node-1')

    // a tab still on the older code writes its list again
    localStorage.setItem(`${PREFIX}node-1`, list)

    expect(clientIds()).toEqual(['old'])
  })

  it('reads an older list a tab added to after it was split, when the store is too full to split it again', () => {
    const old = { savedAt: '2026-09-30T10:00:00.000Z', slides: [{ clientId: 'old' }], sticky: true }
    localStorage.setItem(`${PREFIX}node-1`, JSON.stringify([old]))
    readRecovery('node-1')
    const added = { savedAt: '2026-09-30T10:05:00.000Z', slides: [{ clientId: 'added' }] }
    localStorage.setItem(`${PREFIX}node-1`, JSON.stringify([old, added]))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(clientIds()).toEqual(['old', 'added'])
  })

  it('reads an older list as is when the store is too full to split it', () => {
    const list = JSON.stringify([
      { savedAt: '2026-09-30T10:00:00.000Z', slides: [{ clientId: 'old' }], sticky: true },
    ])
    localStorage.setItem(`${PREFIX}node-1`, list)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(clientIds()).toEqual(['old'])
    vi.restoreAllMocks()
    expect(localStorage.getItem(`${PREFIX}node-1`)).toBe(list)
  })

  it("on opening, keeps another page load's different copy as sticky and removes one the room holds", async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'shown' }], at(1))
    const tabC = await otherTab()
    tabC.keepRecovery('node-1', [{ clientId: 'unsent' }], at(2))
    const [same, different] = [recordKey('node-1', 'shown'), recordKey('node-1', 'unsent')]

    const touched = touchedKeys(() => keepOutlivedRecovery('node-1', [{ clientId: 'shown' }]))

    expect(kept()).toEqual([['unsent', true]])
    expect(touched.sort()).toEqual([`remove ${same}`, `set ${different}`])
  })

  it('on opening, keeps a copy its tab wrote again between the read and the remove', async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'shown' }], at(1))
    const key = recordKey('node-1', 'shown')
    const rewritten = JSON.stringify({
      savedAt: at(2).now.toISOString(),
      slides: [{ clientId: 'newer' }],
    })
    // the first read sees the copy the room holds; tab B writes newer work straight after it
    const { getItem, setItem } = Storage.prototype
    let reads = 0
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, read) {
      const value = getItem.call(this, read)
      if (read === key && reads++ === 0) setItem.call(this, key, rewritten)
      return value
    })

    keepOutlivedRecovery('node-1', [{ clientId: 'shown' }])
    vi.restoreAllMocks()

    expect(clientIds()).toEqual(['newer'])
  })

  it('discards and marks a download on that one copy alone', () => {
    downloadedFiles()
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true, ...at(1) })
    keepRecovery('node-1', [{ clientId: 'newer' }], { sticky: true, ...at(2) })
    const [older, newer] = [recordKey('node-1', 'older'), recordKey('node-1', 'newer')]

    expect(touchedKeys(() => downloadRecovery('node-1', 'Plan'))).toEqual([`set ${newer}`])
    const id = older.slice(`${PREFIX}node-1:`.length)
    const shown = { savedAt: at(1).now.toISOString(), slides: [{ clientId: 'older' }] }
    expect(touchedKeys(() => discardRecovery('node-1', id, shown))).toEqual([`remove ${older}`])
    expect(kept()).toEqual([['newer', true]])
  })

  it('keeps a copy made sticky by keeping it again, past the next unsent one', () => {
    keepRecovery('node-1', [{ clientId: 'unsent' }], at(1))
    keepRecovery('node-1', [{ clientId: 'unsent' }], { sticky: true, ...at(2) })
    keepRecovery('node-1', [{ clientId: 'later' }], at(3))

    expect(kept()).toEqual([
      ['unsent', true],
      ['later', false],
    ])
  })

  it('discarding keeps a copy its tab wrote again since it was shown', async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'shown' }], at(1))
    const [shown] = recoveryRecords('node-1')
    tabB.keepRecovery('node-1', [{ clientId: 'newer' }], at(2))

    discardRecovery('node-1', shown!.id, shown!.copy)

    expect(clientIds()).toEqual(['newer'])
  })
})
