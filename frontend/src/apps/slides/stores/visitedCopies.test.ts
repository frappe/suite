import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  answers,
  CHUNK,
  dataUrl,
  dataUrls,
  ENTRY,
  fake,
  fetchedUrls,
  fileFetches,
  FILES,
  header,
  holdFetches,
  installFakes,
  keys,
  loadStore,
  lockLimits,
  named,
  openedNames,
  refused,
  requests,
  seedFile,
  seedNode,
  seedShell,
  SHELL_KEY,
  shellFetches,
  shellResponse,
  showPresentation,
  slides,
  stalledBodies,
  state,
  TWO_MINUTES,
  visit,
  VISITED,
  visited,
} from './visitedCopies.fakes'

installFakes()

// lets everything that can move without the test's say-so move
async function settle() {
  for (let turn = 0; turn < 200; turn++) {
    await Promise.resolve()
  }
}

function watchDone(run: Promise<unknown>) {
  let isDone = false
  async function finish() {
    await run
    isDone = true
  }

  return { done: finish(), isDone: () => isDone }
}

describe('a first visit', () => {
  it('stores the shell, the files, the data and the marker', async () => {
    await visit()

    expect(keys().sort()).toEqual([SHELL_KEY, ...FILES, ...dataUrls('n1', 'p1'), '/d/n1'].sort())
    expect(header(SHELL_KEY, 'x-visited-build')).toBe('100')
    expect(header(ENTRY, 'x-visited-build')).toBe('100')
    expect(header(dataUrl('n1', 'p1'), 'x-visited-node')).toBe('n1')
    expect(header('/d/n1', 'x-visited-node')).toBe('n1')
    expect(header('/d/n1', 'x-visited-time')).toBe('1000')
  })

  it('marks every request so the worker stays out of it', async () => {
    await visit()

    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((request) => request.isMarked)).toBe(true)
  })

  it('leaves the pins and the button alone', async () => {
    await visit()
    const { offlineCopyStatus, refreshOfflineStatus } = await import('./offlineCopy')
    refreshOfflineStatus('p1')

    expect(openedNames).not.toContain('slides-pinned')
    expect(offlineCopyStatus.value).toBe('none')
    expect(localStorage.getItem('slides-offline-copy:p1')).toBeNull()
  })

  it('takes the csrf label from the fetched shell, never from the page', async () => {
    fake.shell = () => shellResponse('rotated')

    await visit()

    expect(header(SHELL_KEY, 'x-visited-csrf')).toBe('rotated')
  })
})

describe('a later visit', () => {
  it('adds only data and a marker for a second node on one build', async () => {
    await visit()
    requests.length = 0

    await visit('n2', 'p2')

    expect(fetchedUrls().sort()).toEqual(dataUrls('n2', 'p2').sort())
    expect(keys()).toContain('/d/n2')
  })

  it('refetches the data and moves the time, with no shell or file GET', async () => {
    await visit()
    requests.length = 0
    fake.clock = 5000

    await visit()

    expect(fetchedUrls().sort()).toEqual(dataUrls('n1', 'p1').sort())
    expect(header('/d/n1', 'x-visited-time')).toBe('5000')
  })

  // Q18′: a copy visited before the presentation went live would open its rows offline
  it('replaces the rows a copy held from before the presentation went live', async () => {
    const [presentationRead] = dataUrls('n1', 'p1')
    answers.set(presentationRead, '{"message":{"name":"p1","slides":[{"name":"s1"}]}}')
    await visit()
    answers.set(presentationRead, '{"message":{"name":"p1","is_converted":true}}')

    await visit()

    expect(await visited().store.get(presentationRead)?.clone().text()).not.toContain('slides')
  })

  it('refetches the data of a node whose build was captured by another node', async () => {
    seedNode('n1', 500)
    await visit('n2', 'p2')
    requests.length = 0

    await visit('n1', 'id-n1')

    expect(shellFetches()).toEqual([])
    expect(fileFetches()).toEqual([])
    expect(fetchedUrls().sort()).toEqual(dataUrls('n1', 'id-n1').sort())
    expect(await visited().store.get(dataUrl('n1', 'id-n1'))!.clone().text()).not.toBe('old')
  })

  it('refetches the shell when the token changed', async () => {
    await visit()
    requests.length = 0
    window.csrf_token = 'tok2'
    fake.shell = () => shellResponse('tok2')

    await visit()

    expect(shellFetches()).toEqual(['/d/n1'])
    expect(header(SHELL_KEY, 'x-visited-csrf')).toBe('tok2')
  })

  it('refills an emptied cache from the same state', async () => {
    await visit()
    named.delete(VISITED)

    await visit()

    expect(keys().sort()).toEqual([SHELL_KEY, ...FILES, ...dataUrls('n1', 'p1'), '/d/n1'].sort())
  })

  it('runs once per open', async () => {
    const { cancelVisit, rememberVisit } = await loadStore()
    showPresentation()

    await rememberVisit('p1')
    requests.length = 0
    await rememberVisit('p1')

    expect(requests).toEqual([])

    cancelVisit()
    fake.clock = 5000
    await rememberVisit('p1')

    expect(fetchedUrls().sort()).toEqual(dataUrls('n1', 'p1').sort())
    expect(header('/d/n1', 'x-visited-time')).toBe('5000')
  })

  it('captures once when the person leaves and returns inside the wait', async () => {
    const { cancelVisit, rememberVisit } = await loadStore()
    showPresentation()
    const timers: (() => void)[] = []
    vi.stubGlobal('setTimeout', (run: () => void, wait?: number) => {
      if (wait === TWO_MINUTES) {
        return 0
      }

      if (timers.length) {
        queueMicrotask(run)
      } else {
        timers.push(run)
      }

      return 0
    })

    const left = rememberVisit('p1')
    cancelVisit()
    await rememberVisit('p1')

    expect(keys()).toContain('/d/n1')

    timers[0]()
    await left
    await rememberVisit('p1')

    expect(fetchedUrls().filter((url) => url === dataUrl('n1', 'p1'))).toHaveLength(1)
  })
})

describe('a shell it must not store', () => {
  function redirected() {
    const response = shellResponse('tok2')
    Object.defineProperty(response, 'redirected', { value: true })
    return response
  }

  it.each<[string, () => Response]>([
    ['a guest shell', () => shellResponse('tok2', { 'X-Suite-Guest': '1' })],
    ['a redirected shell', redirected],
    ['a failed shell', () => shellResponse('tok2', {}, 500)],
    ['another build', () => shellResponse('tok2', { 'X-Suite-Build': '99' })],
  ])('keeps the old shell and writes nothing for %s', async (_label, make) => {
    await visit()
    const before = keys()
    window.csrf_token = 'tok2'
    fake.shell = make

    await visit('n2', 'p2')

    expect(keys()).toEqual(before)
    expect(header(SHELL_KEY, 'x-visited-csrf')).toBe('tok1')
  })
})

describe('who gets no copy', () => {
  async function expectNothing() {
    expect(requests).toEqual([])
    expect(openedNames).toEqual([])
  }

  it('someone with no cookie user', async () => {
    state.user = null
    await visit()
    await expectNothing()
  })

  it('a composite presentation', async () => {
    const { rememberVisit } = await loadStore()
    showPresentation('n1', 'p1', { is_composite: 1 })
    await rememberVisit('p1')
    await expectNothing()
  })

  it('a presentation with no node yet', async () => {
    const { rememberVisit } = await loadStore()
    showPresentation('', 'p1')
    await rememberVisit('p1')
    await expectNothing()
  })

  it('a page that is offline', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false })
    await visit()
    await expectNothing()
  })

  it('the kill switch', async () => {
    Object.defineProperty(window, 'disable_slides_service_worker', { value: 1, configurable: true })
    await visit()
    await expectNothing()
  })

  it('a pinned presentation', async () => {
    localStorage.setItem('slides-offline-copy:p1', JSON.stringify({ node: 'n1', keys: [] }))
    await visit()
    await expectNothing()
  })

  it('a pinned presentation, until the pin is gone on the same page', async () => {
    localStorage.setItem('slides-offline-copy:p1', JSON.stringify({ node: 'n1', keys: [] }))
    const { rememberVisit } = await loadStore()
    showPresentation()

    await rememberVisit('p1')
    await expectNothing()

    localStorage.removeItem('slides-offline-copy:p1')
    await rememberVisit('p1')

    expect(keys()).toContain('/d/n1')
  })

  it('a page no worker controls', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      serviceWorker: { controller: null, addEventListener: () => {} },
    })
    await visit()
    expect(requests).toEqual([])
    expect(named.get(VISITED)).toBeUndefined()
  })

  it('a refused data GET stores nothing', async () => {
    const [, , media] = dataUrls('n1', 'p1')
    refused.add(media)
    await visit()
    expect(keys()).toEqual([])
  })
})

describe('a build swap', () => {
  beforeEach(() => {
    seedShell('99', 'tok1')
    seedFile('/assets/suite/frontend/assets/old-z9.js', '99')
    seedFile(ENTRY, '99')
    seedNode('old', 500)
  })

  it('leaves the new shell its files and removes the old ones', async () => {
    const order: string[] = []
    visited().putHook = (key) => {
      order.push(key)
    }

    await visit()

    expect(header(SHELL_KEY, 'x-visited-build')).toBe('100')
    expect(keys()).not.toContain('/assets/suite/frontend/assets/old-z9.js')
    expect(order.indexOf(SHELL_KEY)).toBeGreaterThan(order.indexOf(CHUNK))
    expect(order.indexOf(dataUrl('n1', 'p1'))).toBeGreaterThan(order.indexOf(SHELL_KEY))
    expect(order.at(-1)).toBe('/d/n1')
  })

  it('refetches a file the last build also listed, so the delete keeps it', async () => {
    await visit()

    expect(fileFetches()).toContain(ENTRY)
    expect(header(ENTRY, 'x-visited-build')).toBe('100')
  })

  it('keeps the other nodes working under the new shell', async () => {
    await visit()

    expect(keys()).toContain('/d/old')
    expect(keys()).toContain(dataUrl('old', 'id-old'))
  })

  it('deletes by the stored shell, so an interleaved newer capture keeps its files', async () => {
    const newer = '/assets/suite/frontend/assets/newer-n1.js'
    visited().afterPut = (key) => {
      if (key === SHELL_KEY && header(SHELL_KEY, 'x-visited-build') === '100') {
        seedShell('200', 'tok1')
        seedFile(newer, '200')
      }
    }

    await visit()

    expect(header(SHELL_KEY, 'x-visited-build')).toBe('200')
    expect(keys()).toContain(newer)
    expect(keys()).not.toContain(CHUNK)
  })

  it.each([
    ['a file', CHUNK],
    ['the shell', SHELL_KEY],
  ])('keeps the old copy whole when %s fails to store', async (_label, failing) => {
    visited().putHook = (key) => {
      if (key === failing) {
        throw new TypeError('network')
      }
    }

    await visit()

    expect(header(SHELL_KEY, 'x-visited-build')).toBe('99')
    expect(keys()).toContain('/assets/suite/frontend/assets/old-z9.js')
    expect(keys()).not.toContain('/d/n1')
    expect(keys()).not.toContain(dataUrl('n1', 'p1'))
  })
})

describe('a failed data put', () => {
  it('removes the node and leaves the others', async () => {
    seedNode('n1', 500)
    seedNode('other', 600)
    const [, , media] = dataUrls('n1', 'id-n1')
    visited().putHook = (key) => {
      if (key === media) {
        throw new TypeError('network')
      }
    }

    await visit('n1', 'id-n1')

    expect(keys()).not.toContain('/d/n1')
    for (const url of dataUrls('n1', 'id-n1')) {
      expect(keys()).not.toContain(url)
    }

    expect(keys()).toContain('/d/other')
    expect(keys()).toContain(dataUrl('other', 'id-other'))
  })

  it('waits for a lane still landing, so nothing of the node stays', async () => {
    const [first, , media] = dataUrls('n1', 'p1')
    let land!: () => void
    const held = new Promise<void>((resolve) => {
      land = resolve
    })
    let hasFailed = false

    visited().putHook = (key) => {
      if (key === first) {
        return held
      }

      if (key === media) {
        hasFailed = true
        throw new TypeError('network')
      }
    }

    const watched = watchDone(visit())
    await vi.waitFor(() => expect(hasFailed).toBe(true))
    await settle()
    expect(watched.isDone()).toBe(false)

    land()
    await watched.done

    expect(keys()).not.toContain('/d/n1')
    expect(keys()).not.toContain(first)
  })

  it('lets the time limit free a failed capture with a lane stalled on a body', async () => {
    const [first, , media] = dataUrls('n1', 'p1')
    stalledBodies.add(media)
    let hasFailed = false
    visited().putHook = (key) => {
      if (key === first) {
        hasFailed = true
        throw new TypeError('network')
      }
    }

    const watched = watchDone(visit())
    await vi.waitFor(() => expect(hasFailed).toBe(true))
    await settle()
    expect(watched.isDone()).toBe(false)

    const [limit] = lockLimits
    limit()
    await watched.done

    expect(keys()).not.toContain('/d/n1')
    expect(keys()).not.toContain(media)
    expect(lockLimits.size).toBe(0)
  })
})

describe('the limit', () => {
  beforeEach(() => {
    seedShell()
    for (const file of FILES) {
      seedFile(file, '100')
    }
  })

  function seedNodes(count: number) {
    for (let i = 1; i <= count; i++) {
      seedNode(`old${i}`, i * 10)
    }
  }

  it('drops the oldest node at the 21st and keeps the shell and files', async () => {
    seedNodes(20)

    await visit()

    expect(keys()).not.toContain('/d/old1')
    expect(keys()).not.toContain(dataUrl('old1', 'id-old1'))
    expect(keys()).toContain('/d/old2')
    expect(keys()).toContain('/d/n1')
    expect(keys()).toContain(SHELL_KEY)
    for (const file of FILES) {
      expect(keys()).toContain(file)
    }
  })

  it('trims an overshoot on the next capture', async () => {
    seedNodes(22)

    await visit()

    expect(keys()).not.toContain('/d/old1')
    expect(keys()).not.toContain('/d/old2')
    expect(keys()).not.toContain('/d/old3')
    expect(keys()).toContain('/d/old4')
  })

  it('sweeps data whose node has no marker', async () => {
    const stray = dataUrl('gone', 'id-gone')
    visited().store.set(stray, new Response('old', { headers: { 'x-visited-node': 'gone' } }))

    await visit()

    expect(keys()).not.toContain(stray)
  })
})

describe('a full disk', () => {
  beforeEach(() => {
    seedShell()
    for (const file of FILES) {
      seedFile(file, '100')
    }

    seedNode('older', 10)
    seedNode('newer', 20)
  })

  it.each(['QuotaExceededError', 'InvalidAccessError', 'DataError', 'UnknownError'])(
    'drops the oldest node and retries a put refused with %s once',
    async (name) => {
      let failures = 0
      visited().putHook = (key) => {
        if (key === '/d/n1' && failures++ === 0) {
          throw new DOMException('full', name)
        }
      }

      await visit()

      expect(keys()).toContain('/d/n1')
      expect(keys()).not.toContain('/d/older')
      expect(keys()).toContain('/d/newer')
      expect(failures).toBe(2)
    },
  )

  it.each(['AbortError', 'NetworkError'])(
    'evicts nothing when a body fails with %s',
    async (name) => {
      let failures = 0
      visited().putHook = (key) => {
        if (key === '/d/n1') {
          failures++
          throw new DOMException('aborted', name)
        }
      }

      await visit()

      expect(failures).toBe(1)
      expect(keys()).toContain('/d/older')
      expect(keys()).toContain('/d/newer')
    },
  )

  it('stops quietly when the retry fails too', async () => {
    visited().putHook = (key) => {
      if (key === '/d/n1') {
        throw new DOMException('full', 'QuotaExceededError')
      }
    }

    await expect(visit()).resolves.toBeUndefined()

    expect(keys()).not.toContain('/d/n1')
    expect(keys()).toContain('/d/newer')
  })

  it('gives up no copy for a capture stopped while it waited for the lock', async () => {
    visited().store.delete(CHUNK)
    fake.hasWholeBodies = true
    let isStopped = false
    visited().putHook = (key) => {
      if (key === CHUNK) {
        throw new DOMException('full', 'QuotaExceededError')
      }
    }

    const store = await loadStore()
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: {
        request(_name: string, run: () => Promise<unknown>) {
          store.cancelVisit()
          isStopped = true
          return run()
        },
      },
    })
    showPresentation()
    await store.rememberVisit('p1')

    expect(isStopped).toBe(true)
    expect(keys()).toContain('/d/older')
  })

  it('never asks the browser to keep a visited copy', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      serviceWorker: { controller: {}, addEventListener: () => {} },
      storage: { persist },
    })

    await visit()

    expect(persist).not.toHaveBeenCalled()
  })
})

describe('forgetting a node', () => {
  it('removes its marker and data and nothing else', async () => {
    await visit()
    await visit('n2', 'p2')
    const { forgetVisitedNode } = await loadStore()

    await forgetVisitedNode('n1')

    expect(keys()).not.toContain('/d/n1')
    for (const url of dataUrls('n1', 'p1')) {
      expect(keys()).not.toContain(url)
    }

    expect(keys()).toContain('/d/n2')
    expect(keys()).toContain(dataUrl('n2', 'p2'))
    expect(keys()).toContain(SHELL_KEY)
    expect(keys()).toContain(ENTRY)
  })

  it('lets the same open capture it again', async () => {
    const { forgetVisitedNode, rememberVisit } = await loadStore()
    showPresentation()
    await rememberVisit('p1')

    await forgetVisitedNode('n1')
    await rememberVisit('p1')

    expect(keys()).toContain('/d/n1')
  })

  it('never creates the cache', async () => {
    const { forgetVisitedNode } = await loadStore()

    await forgetVisitedNode('n1')

    expect(openedNames).toEqual([])
  })

  it('stops a capture in flight', async () => {
    const release = holdFetches()
    const { rememberVisit, forgetVisitedNode } = await loadStore()
    showPresentation()
    const capture = rememberVisit('p1')
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))

    await forgetVisitedNode('n1')
    release()
    await capture

    expect(keys()).toEqual([])
  })
})

describe('a change during the capture', () => {
  async function during(change: () => void) {
    const release = holdFetches()
    const { rememberVisit } = await loadStore()
    showPresentation()
    const capture = rememberVisit('p1')
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
    change()
    release()
    await capture
  }

  it('writes nothing once a Save copy has made a pin', async () => {
    await during(() =>
      localStorage.setItem('slides-offline-copy:p1', JSON.stringify({ node: 'n1', keys: [] })),
    )
    expect(keys()).toEqual([])
  })

  it('writes nothing once the user has changed', async () => {
    await during(() => {
      state.user = 'b@example.com'
    })
    expect(keys()).toEqual([])
  })

  it('writes nothing once the user has logged out', async () => {
    await during(() => {
      state.user = null
    })
    expect(keys()).toEqual([])
  })

  it('never brings back a cache wiped under it', async () => {
    await during(() => {
      named.delete(VISITED)
    })
    expect(named.get(VISITED)).toBeUndefined()
  })

  it('stops when the surface goes away', async () => {
    const release = holdFetches()
    const { rememberVisit, cancelVisit } = await loadStore()
    showPresentation()
    const capture = rememberVisit('p1')
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
    cancelVisit()
    release()
    await capture

    expect(keys()).toEqual([])
  })
})

describe('cancelling bodies', () => {
  it('never rejects, even on a body that already failed', async () => {
    const { cancelBodies } = await import('@/apps/slides/utils/startupRequests')
    const failed = new ReadableStream({
      start(controller) {
        controller.error(new Error('failed'))
      },
    })

    await expect(cancelBodies([new Response(failed)])).resolves.toBeUndefined()
  })
})

describe('rememberVisit', () => {
  it.each<[string, () => void]>([
    [
      'the cache will not open',
      () =>
        vi.stubGlobal('caches', {
          open: async () => {
            throw new Error('broken')
          },
        }),
    ],
    [
      'the network fails',
      () =>
        vi.stubGlobal('fetch', async () => {
          throw new TypeError('offline')
        }),
    ],
  ])('never rejects when %s', async (_label, breakIt) => {
    breakIt()

    await expect(visit()).resolves.toBeUndefined()
  })

  it('waits three seconds, then for an idle moment', async () => {
    const waits: number[] = []
    let idle = () => {}

    vi.stubGlobal('requestIdleCallback', (run: () => void) => {
      idle = run
    })
    vi.stubGlobal('setTimeout', (run: () => void, ms: number) => {
      waits.push(ms)
      queueMicrotask(run)
      return 0
    })
    const { rememberVisit } = await loadStore()
    showPresentation()

    const capture = rememberVisit('p1')
    await vi.waitFor(() => expect(waits).toContain(3000))
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(requests).toEqual([])

    idle()
    await capture

    expect(requests.length).toBeGreaterThan(0)
  })
})

describe('a picture added after the capture', () => {
  const [, , MEDIA] = dataUrls('n1', 'p1')
  const LISTED = '{"rows":["node1234"]}'

  async function loadStores() {
    const { rememberVisit } = await loadStore()
    const pictures = await import('./visitedMedia')
    localStorage.setItem('slides-caches-user', String(state.user))
    showPresentation()
    return { rememberVisit, ...pictures }
  }

  function addPicture(id = 'node1234') {
    slides.value = [...slides.value, { elements: [{ type: 'image', src: id }] }]
    answers.set(MEDIA, `{"rows":["${id}"]}`)
  }

  async function storedList() {
    return visited().store.get(MEDIA)?.clone().text()
  }

  function listFetches() {
    return fetchedUrls().filter((url) => url === MEDIA).length
  }

  it('reaches the copy, past the worker, and changes nothing else', async () => {
    const { rememberVisit, storeVisitedMedia } = await loadStores()
    await rememberVisit('p1')
    const time = header('/d/n1', 'x-visited-time')
    const before = keys().sort()
    fake.clock = 2000
    requests.length = 0
    addPicture()

    await storeVisitedMedia('p1')

    expect(await storedList()).toBe(LISTED)
    expect(header(MEDIA, 'x-visited-node')).toBe('n1')
    expect(requests).toEqual([{ url: MEDIA, isMarked: true }])
    expect(header('/d/n1', 'x-visited-time')).toBe(time)
    expect(keys().sort()).toEqual(before)
  })

  it('is not overwritten by a capture that fetched before the upload', async () => {
    const { rememberVisit, storeVisitedMedia } = await loadStores()
    const gate = Promise.withResolvers<void>()
    const realFetch = fetch
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === ENTRY) {
        await gate.promise
      }

      return realFetch(url, init)
    })
    const capturing = rememberVisit('p1')
    await vi.waitFor(() => expect(fetchedUrls()).toContain(MEDIA))
    // the capture's answer is built by now, with no row for the picture
    await settle()
    // the slow part of a first store, so the refresh below gets its turn inside the settle
    await storeVisitedMedia('p1')
    addPicture()

    const storing = storeVisitedMedia('p1')
    await settle()
    gate.resolve()
    await Promise.all([capturing, storing])

    expect(await storedList()).toBe(LISTED)
  })

  it('asks once per new picture in an open', async () => {
    const { rememberVisit, storeVisitedMedia } = await loadStores()
    await rememberVisit('p1')
    requests.length = 0
    addPicture()

    await storeVisitedMedia('p1')
    await storeVisitedMedia('p1')
    expect(listFetches()).toBe(1)

    addPicture('node5678')
    await storeVisitedMedia('p1')
    expect(listFetches()).toBe(2)
    expect(await storedList()).toBe('{"rows":["node5678"]}')
  })

  it('keeps the later answer when the earlier one arrives last', async () => {
    const { rememberVisit, storeVisitedMedia } = await loadStores()
    await rememberVisit('p1')
    const gate = Promise.withResolvers<void>()
    const realFetch = fetch
    let asked = 0
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const response = await realFetch(url, init)
      if (url === MEDIA && ++asked === 1) {
        await gate.promise
      }

      return response
    })
    addPicture()
    const first = storeVisitedMedia('p1')
    await vi.waitFor(() => expect(asked).toBe(1))
    addPicture('node5678')
    const second = storeVisitedMedia('p1')

    await settle()
    gate.resolve()
    await Promise.all([first, second])

    expect(await storedList()).toBe('{"rows":["node5678"]}')
  })

  it('stores nothing for a presentation with no finished copy', async () => {
    const { rememberVisit, storeVisitedMedia } = await loadStores()
    refused.add(dataUrl('n1', 'p1'))
    await rememberVisit('p1')
    addPicture()

    await storeVisitedMedia('p1')

    expect(visited().store.has(MEDIA)).toBe(false)
  })

  it('keeps the old list and every other presentation when the put fails', async () => {
    const { rememberVisit, storeVisitedMedia } = await loadStores()
    seedNode('n2', 500)
    await rememberVisit('p1')
    const before = keys().sort()
    const old = await storedList()
    visited().putHook = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }

    addPicture()

    await storeVisitedMedia('p1')

    expect(await storedList()).toBe(old)
    expect(keys().sort()).toEqual(before)
    expect(console.warn).toHaveBeenCalled()
  })

  it('takes no lock while the answer stalls', async () => {
    const { rememberVisit, stopVisitedMedia, storeVisitedMedia } = await loadStores()
    await rememberVisit('p1')
    const old = await storedList()
    const locks = fake.lockRequests
    stalledBodies.add(MEDIA)
    addPicture()

    const storing = storeVisitedMedia('p1')
    await vi.waitFor(() => expect(listFetches()).toBe(2))
    await settle()
    expect(fake.lockRequests).toBe(locks)

    stopVisitedMedia()
    await storing
    expect(await storedList()).toBe(old)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('does not bring back a cache wiped during the fetch', async () => {
    const { rememberVisit, storeVisitedMedia } = await loadStores()
    await rememberVisit('p1')
    const release = holdFetches()
    addPicture()

    const storing = storeVisitedMedia('p1')
    await vi.waitFor(() => expect(listFetches()).toBe(2))
    named.delete(VISITED)
    release()
    await storing

    expect(named.has(VISITED)).toBe(false)
  })

  it('stores nothing once another user signed in during the fetch', async () => {
    const { rememberVisit, storeVisitedMedia } = await loadStores()
    await rememberVisit('p1')
    const old = await storedList()
    const release = holdFetches()
    addPicture()

    const storing = storeVisitedMedia('p1')
    await vi.waitFor(() => expect(listFetches()).toBe(2))
    state.user = 'b@example.com'
    release()
    await storing

    expect(await storedList()).toBe(old)
  })
})
