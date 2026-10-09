import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'

import VersionPreview from './VersionPreview.vue'

const liveEditors = vi.hoisted(() => new Set<object>())

vi.mock('@tiptap/vue-3', async (importOriginal) => {
  const tiptap = await importOriginal<typeof import('@tiptap/vue-3')>()
  class Editor extends tiptap.Editor {
    constructor(options: ConstructorParameters<typeof tiptap.Editor>[0]) {
      super(options)
      liveEditors.add(this)
    }

    destroy() {
      liveEditors.delete(this)
      super.destroy()
    }
  }

  return { ...tiptap, Editor }
})

function storedVersion(html: string) {
  const stored = {
    schema: 'writer-document/1',
    content: 'AAA=',
    html,
    collab: 0,
  }
  return JSON.stringify(stored)
}

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => (resolve = done))
  return { promise, resolve }
}

// A session whose every fetch waits until the test answers it from `requests`
function heldSession(requests: ReturnType<typeof deferred>[]) {
  const fetchLater = () => {
    const request = deferred()
    requests.push(request)
    return request.promise
  }
  return fakeSession(fetchLater)
}

function fakeSession(fetch: (url: string) => Promise<Response>) {
  return {
    versions: { contentUrl: (seq: string) => `/versions/${seq}` },
    credentials: {
      fetch: vi.fn(fetch),
      fetchHeld: fetch,
      group: () => [],
    },
  } as unknown as DocumentSession
}

function mountPreview(session: DocumentSession, seq = 1) {
  const shownSeq = ref(seq)
  const root = document.createElement('div')
  document.body.append(root)
  const render = () => {
    const props = {
      session,
      seq: shownSeq.value,
      label: 'Version',
      settings: {},
      rail: 0,
    }
    return h(VersionPreview, props)
  }
  const app = createApp({ setup: () => render })
  app.mount(root)

  return {
    root,
    shownSeq,
    unmount: () => {
      app.unmount()
      root.remove()
    },
  }
}

const settle = () => new Promise((done) => setTimeout(done, 0))

afterEach(() => {
  vi.unstubAllGlobals()
  liveEditors.clear()
})

describe('VersionPreview', () => {
  it('reads the version through the document credentials, so a share link opens it', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 403 }))
    const session = fakeSession(async () => new Response(storedVersion('<p>Shared draft</p>')))
    const preview = mountPreview(session, 4)

    await vi.waitFor(() => expect(preview.root.textContent).toContain('Shared draft'))
    expect(session.credentials.fetch).toHaveBeenCalledWith('/versions/4')
    preview.unmount()
  })

  it('shows a version whose HTML holds a table', async () => {
    const html =
      '<table><colgroup><col><col></colgroup><tbody><tr><th><p>Owner</p></th><th><p>Due</p></th></tr>' +
      '<tr><td><p>Asha</p></td><td><p>Friday</p></td></tr></tbody></table>'
    const session = fakeSession(async () => new Response(storedVersion(html)))
    const preview = mountPreview(session)

    await vi.waitFor(() => expect(preview.root.querySelectorAll('td')).toHaveLength(2))
    expect(preview.root.textContent).toContain('Friday')
    expect(preview.root.textContent).not.toContain("can't be shown")
    preview.unmount()
  })

  it('keeps the shown version, with no loading placeholder, until the next one replaces it', async () => {
    const requests: ReturnType<typeof deferred>[] = []
    const preview = mountPreview(heldSession(requests))
    requests[0].resolve(new Response(storedVersion('<p>First</p>')))
    await vi.waitFor(() => expect(preview.root.textContent).toContain('First'))

    preview.shownSeq.value = 2
    await settle()
    expect(preview.root.textContent).toContain('First')
    expect(preview.root.querySelector('[aria-label="Version preview"]')).not.toBeNull()

    requests[1].resolve(new Response(storedVersion('<p>Second</p>')))
    await vi.waitFor(() => expect(preview.root.textContent).toContain('Second'))
    expect(preview.root.textContent).not.toContain('First')
    await settle()
    expect(liveEditors.size).toBe(1)
    preview.unmount()
  })

  it('leaves no editor behind when closed before the version arrives', async () => {
    const pending = deferred()
    const session = fakeSession(() => pending.promise)
    const preview = mountPreview(session)

    preview.unmount()
    pending.resolve(new Response(storedVersion('<p>Late</p>')))
    await settle()
    await settle()

    expect(liveEditors.size).toBe(0)
  })

  it('keeps one editor when the user goes back to a version while it still loads', async () => {
    const requests: ReturnType<typeof deferred>[] = []
    const preview = mountPreview(heldSession(requests), 1)
    preview.shownSeq.value = 2
    await nextTick()
    preview.shownSeq.value = 1
    await nextTick()

    requests[0].resolve(new Response(storedVersion('<p>First</p>')))
    await settle()
    requests[2].resolve(new Response(storedVersion('<p>First again</p>')))
    requests[1].resolve(new Response(storedVersion('<p>Second</p>')))
    await vi.waitFor(() => expect(preview.root.textContent).toContain('First again'))
    await settle()

    expect(liveEditors.size).toBe(1)
    expect(preview.root.textContent).not.toContain('Second')
    preview.unmount()
    expect(liveEditors.size).toBe(0)
  })
})
