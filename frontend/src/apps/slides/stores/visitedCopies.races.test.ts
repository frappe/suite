import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHUNK,
  dataUrl,
  dataUrls,
  fake,
  holdFetches,
  installFakes,
  keys,
  loadStore,
  lockLimits,
  presentationId,
  requests,
  seedNode,
  SHELL_KEY,
  showPresentation,
  stalledBodies,
  state,
  visited,
} from './visitedCopies.fakes'

installFakes()

describe('a change during the puts', () => {
  type Store = Awaited<ReturnType<typeof loadStore>>

  const changes: [string, (store: Store) => void][] = [
    ['an abort', ({ cancelVisit }) => cancelVisit()],
    [
      'a user change',
      () => {
        state.user = 'b@example.com'
      },
    ],
    [
      'a new pin',
      () =>
        localStorage.setItem(
          `slides-offline-copy:${presentationId.value}`,
          JSON.stringify({ node: 'n1', keys: [] }),
        ),
    ],
  ]

  async function changeAtPut(put: string, change: (store: Store) => void, id = 'p1') {
    const store = await loadStore()
    showPresentation('n1', id)
    let isDone = false
    visited().putHook = (key) => {
      if (key === put && !isDone) {
        isDone = true
        change(store)
      }
    }

    await store.rememberVisit(id)
  }

  function expectNoData() {
    expect(keys()).not.toContain('/d/n1')
    for (const url of dataUrls('n1', 'p1')) {
      expect(keys()).not.toContain(url)
    }
  }

  it.each(changes)('stores no shell or data after %s during a file', async (_label, change) => {
    await changeAtPut(CHUNK, change)

    expect(keys()).not.toContain(SHELL_KEY)
    expectNoData()
  })

  async function expectOldCopy() {
    expect(keys()).toContain('/d/n1')
    for (const url of dataUrls('n1', 'id-n1')) {
      expect(await visited().store.get(url)!.clone().text()).toBe('old')
    }
  }

  it.each(changes)('keeps the old copy after %s during the shell', async (_, change) => {
    seedNode('n1', 500)

    await changeAtPut(SHELL_KEY, change, 'id-n1')

    await expectOldCopy()
  })

  it.each([
    ['a file', CHUNK],
    ['the shell', SHELL_KEY],
  ])('keeps the old copy on an abort during %s with the bodies received', async (_, put) => {
    fake.hasWholeBodies = true
    seedNode('n1', 500)

    await changeAtPut(put, ({ cancelVisit }) => cancelVisit(), 'id-n1')

    await expectOldCopy()
  })

  it.each(changes)('stores no marker after %s during the data', async (_label, change) => {
    await changeAtPut(dataUrl('n1', 'p1'), change)

    expect(keys()).not.toContain('/d/n1')
  })

  it.each([
    ['still on their way', false],
    ['received whole', true],
  ])('removes the old copy on an abort during the data, bodies %s', async (_, isWhole) => {
    fake.hasWholeBodies = isWhole
    seedNode('n1', 500)

    await changeAtPut(dataUrl('n1', 'id-n1'), ({ cancelVisit }) => cancelVisit(), 'id-n1')

    expect(keys()).not.toContain('/d/n1')
    for (const url of dataUrls('n1', 'id-n1')) {
      expect(keys()).not.toContain(url)
    }
  })

  it('removes a marker that an abort lands behind', async () => {
    seedNode('n1', 500)

    await changeAtPut('/d/n1', ({ cancelVisit }) => cancelVisit(), 'id-n1')

    expect(keys()).not.toContain('/d/n1')
    for (const url of dataUrls('n1', 'id-n1')) {
      expect(keys()).not.toContain(url)
    }
  })

  it('cancels the data bodies a stopped store never read', async () => {
    const cancelled: string[] = []
    const serve = fetch
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const response = await serve(url, init)
      if (!dataUrls('n1', 'p1').includes(url)) {
        return response
      }

      const body = new ReadableStream({
        cancel() {
          cancelled.push(url)
        },
      })
      return new Response(body, { status: response.status, headers: response.headers })
    })

    await changeAtPut(CHUNK, () => {
      state.user = 'b@example.com'
    })

    expect(cancelled.sort()).toEqual(dataUrls('n1', 'p1').sort())
  })
})

describe('two tabs', () => {
  // the first tab's capture, stopped just before its marker lands
  async function firstTabAtItsMarker() {
    const tab = await loadStore()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    let isAtMarker = false
    visited().putHook = (key) => {
      if (key === '/d/n1') {
        isAtMarker = true
        return held
      }
    }

    showPresentation('n1', 'p1')
    const capture = tab.rememberVisit('p1')
    await vi.waitFor(() => expect(isAtMarker).toBe(true))
    return { capture, release }
  }

  // it either finishes, without a lock, or queues behind the holder
  async function finishedOrQueued(other: Promise<unknown>) {
    await Promise.race([other, vi.waitFor(() => expect(fake.lockRequests).toBe(2))])
  }

  it('makes a second trim wait for the first marker, so all the data stays', async () => {
    const first = await firstTabAtItsMarker()
    const tab = await loadStore()
    showPresentation('n2', 'p2')

    const second = tab.rememberVisit('p2')
    await finishedOrQueued(second)
    first.release()
    await Promise.all([first.capture, second])

    expect(keys()).toContain('/d/n1')
    expect(keys()).toContain('/d/n2')
    for (const url of [...dataUrls('n1', 'p1'), ...dataUrls('n2', 'p2')]) {
      expect(keys()).toContain(url)
    }
  })

  it('makes a forget wait, so no marker lands over removed data', async () => {
    const first = await firstTabAtItsMarker()
    const tab = await loadStore()

    const forgetting = tab.forgetVisitedNode('n1')
    await finishedOrQueued(forgetting)
    first.release()
    await Promise.all([first.capture, forgetting])

    expect(keys()).not.toContain('/d/n1')
    for (const url of dataUrls('n1', 'p1')) {
      expect(keys()).not.toContain(url)
    }
  })

  it('lets an abort free a holder stalled on a body', async () => {
    const [, , media] = dataUrls('n1', 'p1')
    stalledBodies.add(media)
    const stalled = await loadStore()
    showPresentation('n1', 'p1')
    const capture = stalled.rememberVisit('p1')
    await vi.waitFor(() => expect(fake.lockRequests).toBe(1))
    await vi.waitFor(() => expect(keys()).toContain(dataUrl('n1', 'p1')))

    const tab = await loadStore()
    showPresentation('n2', 'p2')
    const second = tab.rememberVisit('p2')
    await vi.waitFor(() => expect(fake.lockRequests).toBe(2))
    stalled.cancelVisit()
    await Promise.all([capture, second])

    expect(keys()).not.toContain('/d/n1')
    expect(keys()).toContain('/d/n2')
  })

  it('frees a holder stalled on a body once its time is up, so a forget can finish', async () => {
    const [, , media] = dataUrls('n1', 'p1')
    stalledBodies.add(media)
    const stalled = await loadStore()
    showPresentation('n1', 'p1')
    const capture = stalled.rememberVisit('p1')
    await vi.waitFor(() => expect(keys()).toContain(dataUrl('n1', 'p1')))

    const tab = await loadStore()
    let hasForgotten = false
    async function forget() {
      await tab.forgetVisitedNode('n2')
      hasForgotten = true
    }

    const forgetting = forget()
    await vi.waitFor(() => expect(fake.lockRequests).toBe(2))
    await new Promise((resolve) => queueMicrotask(() => resolve(null)))
    expect(hasForgotten).toBe(false)

    expect(lockLimits.size).toBe(1)
    const [limit] = lockLimits
    limit()
    await Promise.all([capture, forgetting])

    expect(hasForgotten).toBe(true)
    expect(keys()).not.toContain('/d/n1')
  })

  it('runs the clock only while holding the lock, and leaves none behind', async () => {
    const release = holdFetches()
    const tab = await loadStore()
    showPresentation('n1', 'p1')
    const capture = tab.rememberVisit('p1')
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
    expect(lockLimits.size).toBe(0)

    release()
    await capture

    expect(keys()).toContain('/d/n1')
    expect(lockLimits.size).toBe(0)
  })
})

describe('a browser with no Web Locks', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })
  })

  it('still stores a whole copy, and a forget still removes it', async () => {
    const tab = await loadStore()
    showPresentation('n1', 'p1')

    await tab.rememberVisit('p1')

    expect(keys()).toContain('/d/n1')
    for (const url of dataUrls('n1', 'p1')) {
      expect(keys()).toContain(url)
    }

    await tab.forgetVisitedNode('n1')

    expect(keys()).not.toContain('/d/n1')
    for (const url of dataUrls('n1', 'p1')) {
      expect(keys()).not.toContain(url)
    }
  })
})
