import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  discardRecovery,
  downloadRecovery,
  keepRecovery,
  newestRecovery,
  readRecovery,
  recoveryEntries,
  recoveryFile,
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
  const record = recoveryEntries(node).find(
    // SAFETY: each copy these tests keep starts with a slide that has a clientId
    ({ copy }) => (copy.slides[0] as { clientId: string }).clientId === clientId,
  )
  if (!record) throw new Error(`no record holds ${clientId}`)
  return `${PREFIX}${node}:${record.id.split('@')[0]}`
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
      expect(downloadRecovery('node-1', 'Plan')).toBe('downloaded')
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
    expect(downloadRecovery('node-1', 'Plan')).toBe('none')
  })

  it('says the download went unnoted when the store is too full to mark it', () => {
    const files = downloadedFiles()
    keepRecovery('node-1', [{ clientId: 'kept' }], { sticky: true })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(downloadRecovery('node-1', 'Plan')).toBe('unmarked')

    expect(files).toHaveBeenCalledTimes(1)
    expect(readRecovery('node-1')).toEqual([expect.not.objectContaining({ downloaded: true })])
  })

  it('keeps an identical copy sticky at the end, newly dated, with its download remembered', () => {
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

    const newest = newestRecovery('node-1')!
    discardRecovery('node-1', newest.id, newest.copy)

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

  it('reads an older single list as its copies, and hides one discarded there', () => {
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

    const old = recoveryEntries('node-1').find(({ copy }) => !copy.sticky)!
    discardRecovery('node-1', old.id, old.copy)
    expect(kept()).toEqual([['old sticky', true]])
  })

  it('writes nothing to an older list, whatever is kept, downloaded or discarded', () => {
    downloadedFiles()
    const list = JSON.stringify([
      { savedAt: '2026-09-30T10:00:00.000Z', slides: [{ clientId: 'old' }] },
      { savedAt: '2026-09-30T10:05:00.000Z', slides: [{ clientId: 'old sticky' }], sticky: true },
    ])
    localStorage.setItem(`${PREFIX}node-1`, list)

    const touched = touchedKeys(() => {
      keepRecovery('node-1', [{ clientId: 'old sticky' }])
      keepRecovery('node-1', [{ clientId: 'new' }], { sticky: true })
      downloadRecovery('node-1', 'Plan')
      downloadRecovery('node-1', 'Plan')
      for (const { id, copy } of recoveryEntries('node-1')) discardRecovery('node-1', id, copy)
    })

    expect(touched.filter((key) => key.endsWith(`${PREFIX}node-1`))).toEqual([])
    expect(localStorage.getItem(`${PREFIX}node-1`)).toBe(list)
    expect(readRecovery('node-1')).toEqual([])
  })

  it('keeps a discarded older copy hidden when a tab on the older code writes the list again', () => {
    const list = JSON.stringify([
      { savedAt: '2026-09-30T10:00:00.000Z', slides: [{ clientId: 'old' }], sticky: true },
    ])
    localStorage.setItem(`${PREFIX}node-1`, list)
    const [old] = recoveryEntries('node-1')
    discardRecovery('node-1', old!.id, old!.copy)

    localStorage.setItem(`${PREFIX}node-1`, list)

    expect(readRecovery('node-1')).toEqual([])
  })

  it('reads a copy a tab on the older code adds to the list', () => {
    const old = { savedAt: '2026-09-30T10:00:00.000Z', slides: [{ clientId: 'old' }], sticky: true }
    localStorage.setItem(`${PREFIX}node-1`, JSON.stringify([old]))
    readRecovery('node-1')
    const added = { savedAt: '2026-09-30T10:05:00.000Z', slides: [{ clientId: 'added' }] }
    localStorage.setItem(`${PREFIX}node-1`, JSON.stringify([old, added]))

    expect(clientIds()).toEqual(['old', 'added'])
  })

  it('throws and keeps an older copy listed when the store is too full to mark it discarded', () => {
    localStorage.setItem(
      `${PREFIX}node-1`,
      JSON.stringify([{ savedAt: '2026-09-30T10:00:00.000Z', slides: [{ clientId: 'old' }] }]),
    )
    const [old] = recoveryEntries('node-1')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(() => discardRecovery('node-1', old!.id, old!.copy)).toThrow()

    vi.restoreAllMocks()
    expect(clientIds()).toEqual(['old'])
  })

  it("keeps a tab's sticky copy when the tab that kept the same slides unsent keeps newer ones", async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'x' }], at(1))
    keepRecovery('node-1', [{ clientId: 'x' }], { sticky: true, ...at(2) })

    tabB.keepRecovery('node-1', [{ clientId: 'y' }], at(3))

    expect(kept()).toEqual([
      ['x', true],
      ['y', false],
    ])
  })

  it('shows the same slides kept by two tabs as one copy, at the newer place, and discards both', async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'x' }], at(1))
    keepRecovery('node-1', [{ clientId: 'y' }], { sticky: true, ...at(2) })
    keepRecovery('node-1', [{ clientId: 'x' }], { sticky: true, ...at(3) })

    expect(kept()).toEqual([
      ['y', true],
      ['x', true],
    ])

    const shown = newestRecovery('node-1')!
    discardRecovery('node-1', shown.id, shown.copy)
    expect(kept()).toEqual([['y', true]])
  })

  it("keeps a tab's sticky copy of slides another tab holds sticky, when that tab discards its own", async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'x' }], { sticky: true, ...at(1) })
    const shown = tabB.newestRecovery('node-1')!

    keepRecovery('node-1', [{ clientId: 'x' }], { sticky: true, ...at(2) })
    tabB.discardRecovery('node-1', shown.id, shown.copy)

    expect(kept()).toEqual([['x', true]])
  })

  it("keeps a tab's unsent copy of slides another tab holds sticky, when that tab discards its own", async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'x' }], { sticky: true, ...at(1) })
    const shown = tabB.newestRecovery('node-1')!

    keepRecovery('node-1', [{ clientId: 'x' }], at(2))
    tabB.discardRecovery('node-1', shown.id, shown.copy)

    expect(kept()).toEqual([['x', false]])
  })

  it('keeps a copy its tab wrote again with the same slides since it was shown', async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'x' }], at(1))
    const shown = newestRecovery('node-1')!

    tabB.keepRecovery('node-1', [{ clientId: 'x' }], at(2))
    discardRecovery('node-1', shown.id, shown.copy)

    expect(readRecovery('node-1')).toEqual([
      { savedAt: at(2).now.toISOString(), slides: [{ clientId: 'x' }], sticky: false },
    ])
  })

  it('marks no download on a copy its tab wrote again while the file went out', async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'x' }], at(1))
    downloadedFiles()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      tabB.keepRecovery('node-1', [{ clientId: 'y' }], at(2))
    })

    expect(downloadRecovery('node-1', 'Plan')).toBe('downloaded')

    expect(readRecovery('node-1')).toEqual([
      { savedAt: at(2).now.toISOString(), slides: [{ clientId: 'y' }], sticky: false },
    ])
  })

  it("dismisses another page load's unsent copy without removing its key", async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'shown' }], at(1))
    const key = recordKey('node-1', 'shown')
    const [shown] = recoveryEntries('node-1')

    const touched = touchedKeys(() => discardRecovery('node-1', shown!.id, shown!.copy))

    expect(touched).toEqual([expect.stringMatching(`^set ${PREFIX}node-1:dismissed:`)])
    expect(localStorage.getItem(key)).not.toBeNull()
    expect(readRecovery('node-1')).toEqual([])
  })

  it('lists again a newer copy the tab writes under a key its earlier copy was dismissed from', async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'shown' }], at(1))
    const [shown] = recoveryEntries('node-1')
    discardRecovery('node-1', shown!.id, shown!.copy)

    tabB.keepRecovery('node-1', [{ clientId: 'shown' }], at(2))

    expect(clientIds()).toEqual(['shown'])
  })

  it('keeps listing a copy its tab wrote again between the check and the dismissal', async () => {
    const tabB = await otherTab()
    tabB.keepRecovery('node-1', [{ clientId: 'shown' }], at(1))
    const key = recordKey('node-1', 'shown')
    const [shown] = recoveryEntries('node-1')
    // the discard's read sees the copy as shown; tab B writes newer work straight after it
    const { getItem } = Storage.prototype
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, read) {
      const value = getItem.call(this, read)
      if (read === key) {
        vi.restoreAllMocks()
        tabB.keepRecovery('node-1', [{ clientId: 'newer' }], at(2))
      }
      return value
    })

    discardRecovery('node-1', shown!.id, shown!.copy)
    vi.restoreAllMocks()

    expect(clientIds()).toEqual(['newer'])
  })

  it('discards and marks a download on that one copy alone', () => {
    downloadedFiles()
    keepRecovery('node-1', [{ clientId: 'older' }], { sticky: true, ...at(1) })
    keepRecovery('node-1', [{ clientId: 'newer' }], { sticky: true, ...at(2) })
    const [older, newer] = [recordKey('node-1', 'older'), recordKey('node-1', 'newer')]

    const newerId = newer.slice(`${PREFIX}node-1:`.length)
    expect(touchedKeys(() => downloadRecovery('node-1', 'Plan'))).toEqual([
      expect.stringMatching(`^set ${PREFIX}node-1:downloaded:${newerId}:`),
    ])
    const [shown] = recoveryEntries('node-1')
    expect(touchedKeys(() => discardRecovery('node-1', shown!.id, shown!.copy))).toEqual([
      `remove ${older}`,
    ])
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
    const [shown] = recoveryEntries('node-1')
    tabB.keepRecovery('node-1', [{ clientId: 'newer' }], at(2))

    discardRecovery('node-1', shown!.id, shown!.copy)

    expect(clientIds()).toEqual(['newer'])
  })
})
