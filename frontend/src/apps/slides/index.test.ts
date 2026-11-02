import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  guards: [] as Array<() => unknown>,
  user: null as string | null,
}))

vi.mock('@/apps/slides/router', () => ({
  router: { beforeEach: (guard: () => unknown) => state.guards.push(guard) },
}))
vi.mock('@/platform/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/session')>()),
  getCookieSessionUser: () => state.user,
}))
vi.mock('@/apps/slides/stores/presentation', async () => {
  const { ref } = await import('vue')
  return { presentationDoc: ref(null), presentationId: ref(null), viewOnly: ref(false) }
})
vi.mock('@/apps/slides/stores/slide', async () => ({ slides: (await import('vue')).ref([]) }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: (src: string) => src }))

const { slidesDocument } = await import('./index')

const pinned = new Map<string, Response>()
const wiped: string[] = []

function pin(docname: string, node: string) {
  const keys = [`/d/${node}`, `/private/files/${docname}.png`]
  for (const key of keys) {
    pinned.set(key, new Response(key))
  }

  localStorage.setItem(`slides-offline-copy:${docname}`, JSON.stringify({ node, keys }))
}

function hasCopy(docname: string) {
  return localStorage.getItem(`slides-offline-copy:${docname}`) !== null
}

async function navigate() {
  for (const guard of state.guards) {
    await guard()
  }
}

beforeEach(() => {
  localStorage.clear()
  pinned.clear()
  state.user = null
  wiped.length = 0
  vi.stubGlobal('navigator', { ...navigator, onLine: true })
  vi.stubGlobal('caches', {
    open: async () => ({
      delete: async (key: string) => pinned.delete(key),
      keys: async () => [],
    }),
    has: async () => false,
    delete: async (name: string) => {
      wiped.push(name)
      if (name === 'slides-pinned') {
        pinned.clear()
      }

      return true
    },
  })
  pin('p1', 'n1')
  pin('p2', 'n2')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the slides document', () => {
  it('forgets the copy of a node and keeps the others', async () => {
    slidesDocument.forgetNode!('n1')

    await vi.waitFor(() => expect(hasCopy('p1')).toBe(false))
    expect(pinned.has('/d/n1')).toBe(false)
    expect(hasCopy('p2')).toBe(true)
    expect(pinned.has('/d/n2')).toBe(true)
  })
})

describe('a navigation', () => {
  it("clears the last user's copies when another user arrives", async () => {
    localStorage.setItem('slides-caches-user', 'a@example.com')
    state.user = 'b@example.com'

    await navigate()

    expect(hasCopy('p1')).toBe(false)
    expect(hasCopy('p2')).toBe(false)
    expect(pinned.size).toBe(0)
  })

  it('keeps the copies of the same user coming back', async () => {
    localStorage.setItem('slides-caches-user', 'a@example.com')
    state.user = 'a@example.com'

    await navigate()

    expect(hasCopy('p1')).toBe(true)
    expect(pinned.size).toBe(4)
  })

  it('clears only the visited copies without a signed-in user', async () => {
    localStorage.setItem('slides-caches-user', 'a@example.com')

    await navigate()

    expect(wiped).toEqual(['slides-visited'])
    expect(hasCopy('p1')).toBe(true)
    expect(pinned.size).toBe(4)
  })

  it('clears nothing offline without a signed-in user', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false })

    await navigate()

    expect(wiped).toEqual([])
    expect(hasCopy('p1')).toBe(true)
  })

  it('clears the visited copies when another user arrives, before the guard lets a page load', async () => {
    localStorage.setItem('slides-caches-user', 'a@example.com')
    state.user = 'b@example.com'
    let release = () => {}

    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal('caches', {
      delete: async (name: string) => {
        wiped.push(name)
        await held
        return true
      },
    })
    let isThrough = false
    async function runGuards() {
      await navigate()
      isThrough = true
    }

    const guards = runGuards()
    await vi.waitFor(() => expect(wiped).toContain('slides-visited'))

    expect(isThrough).toBe(false)

    release()
    await guards

    expect(isThrough).toBe(true)
  })

  it('still lets the navigation through when clearing fails', async () => {
    localStorage.setItem('slides-caches-user', 'a@example.com')
    state.user = 'b@example.com'
    vi.stubGlobal('caches', {
      delete: async () => {
        throw new Error('broken cache')
      },
    })

    await expect(navigate()).resolves.toBeUndefined()
  })
})
