import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { translationPlugin } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

const state = vi.hoisted(() => ({
  guards: [] as Array<() => unknown>,
  user: null as string | null,
  open: vi.fn(),
}))

vi.mock('@/apps/slides/router', () => ({
  router: { beforeEach: (guard: () => unknown) => state.guards.push(guard) },
}))
vi.mock('@/boot/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/boot/session')>()),
  getSessionUser: () => state.user,
}))
vi.mock('@/apps/slides/stores/presentation', async () => {
  const { ref } = await import('vue')
  return { presentationDoc: ref(null), presentationId: ref(null), viewOnly: ref(false) }
})
vi.mock('@/apps/slides/stores/slide', async () => ({ slides: (await import('vue')).ref([]) }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: (src: string) => src }))
vi.mock('@/apps/drive', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  return {
    isDriveLocked: () => false,
    isDriveNodeLocked: async () => false,
    openDocumentSession: state.open,
    driveNodeRoute: (node: string) => ({ path: `/d/${node}` }),
    filePreviewSurface: {},
    DriveUnlockScreen: define({ render: () => null }),
    DriveDocumentHeaderSkeleton: define({ setup: () => () => render('header') }),
  }
})

const { slidesDocument } = await import('./index')
vi.doMock('@/composition/documentRegistry', () => ({ documentTypes: [slidesDocument] }))
const { default: DocumentHost } = await import('@/composition/DocumentHost.vue')

const pinned = new Map<string, Response>()

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

async function openHost() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/d/:node/:slug?', name: 'document-host', component: DocumentHost }],
  })
  await router.push('/d/n1/deck')
  await router.isReady()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(defineComponent({ setup: () => () => h(DocumentHost) }))
  app.use(router).use(translationPlugin)
  app.mount(root)
  return { root, app }
}

beforeEach(() => {
  localStorage.clear()
  pinned.clear()
  state.user = null
  state.open.mockReset()
  vi.stubGlobal('caches', {
    open: async () => ({
      delete: async (key: string) => pinned.delete(key),
      keys: async () => [],
    }),
    delete: async (name: string) => {
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
  document.body.innerHTML = ''
})

describe('the slides document', () => {
  it('forgets the copy of a node and keeps the others', async () => {
    slidesDocument.forgetNode!('n1')

    await vi.waitFor(() => expect(hasCopy('p1')).toBe(false))
    expect(pinned.has('/d/n1')).toBe(false)
    expect(hasCopy('p2')).toBe(true)
    expect(pinned.has('/d/n2')).toBe(true)
  })

  it('keeps a pinned copy when the presentation is opened offline', async () => {
    state.open.mockRejectedValue(
      new TransportError({ type: 'NetworkError', message: 'offline', status: 0 }),
    )
    const { root, app } = await openHost()

    await vi.waitFor(() => expect(root.textContent).toContain('Could not open this document'))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(hasCopy('p1')).toBe(true)
    expect(pinned.has('/d/n1')).toBe(true)
    app.unmount()
  })

  it('drops the copy when opening the presentation is refused', async () => {
    state.open.mockRejectedValue(
      new TransportError({ type: 'DrivePermissionDenied', message: 'denied', status: 403 }),
    )
    const { app } = await openHost()

    await vi.waitFor(() => expect(hasCopy('p1')).toBe(false))
    expect(pinned.has('/d/n1')).toBe(false)
    expect(hasCopy('p2')).toBe(true)
    app.unmount()
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

  it('clears nothing without a signed-in user', async () => {
    localStorage.setItem('slides-caches-user', 'a@example.com')

    await navigate()

    expect(hasCopy('p1')).toBe(true)
    expect(pinned.size).toBe(4)
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
