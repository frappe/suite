import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'

import VersionPreview from './VersionPreview.vue'

const live = vi.hoisted(() => new Set<object>())

vi.mock('@tiptap/vue-3', async (importOriginal) => {
  const tiptap = await importOriginal<typeof import('@tiptap/vue-3')>()
  class Editor extends tiptap.Editor {
    constructor(options: ConstructorParameters<typeof tiptap.Editor>[0]) {
      super(options)
      live.add(this)
    }
    destroy() {
      live.delete(this)
      super.destroy()
    }
  }
  return { ...tiptap, Editor }
})

const version = (html: string) =>
  JSON.stringify({ schema: 'writer-document/1', content: 'AAA=', html, collab: 0 })

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => (resolve = done))
  return { promise, resolve }
}

function fakeSession(fetch: (url: string) => Promise<Response>) {
  return {
    versions: { contentUrl: (seq: string) => `/versions/${seq}` },
    credentials: { fetch: vi.fn(fetch), fetchHeld: fetch, group: () => [] },
  } as unknown as DocumentSession
}

function mountPreview(session: DocumentSession, seq = 1) {
  const shown = ref(seq)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () => h(VersionPreview, { session, seq: shown.value, label: 'Version' }),
  })
  app.mount(root)
  return {
    root,
    shown,
    unmount: () => {
      app.unmount()
      root.remove()
    },
  }
}

const settle = () => new Promise((done) => setTimeout(done, 0))

afterEach(() => {
  vi.unstubAllGlobals()
  live.clear()
})

describe('VersionPreview', () => {
  it('reads the version through the document credentials, so a share link opens it', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 403 }))
    const session = fakeSession(async () => new Response(version('<p>Shared draft</p>')))
    const preview = mountPreview(session, 4)

    await vi.waitFor(() => expect(preview.root.textContent).toContain('Shared draft'))
    expect(session.credentials.fetch).toHaveBeenCalledWith('/versions/4')
    preview.unmount()
  })

  it('shows a version whose HTML holds a table', async () => {
    const html =
      '<table><colgroup><col><col></colgroup><tbody><tr><th><p>Owner</p></th><th><p>Due</p></th></tr>' +
      '<tr><td><p>Asha</p></td><td><p>Friday</p></td></tr></tbody></table>'
    const preview = mountPreview(fakeSession(async () => new Response(version(html))))

    await vi.waitFor(() => expect(preview.root.querySelectorAll('td')).toHaveLength(2))
    expect(preview.root.textContent).toContain('Friday')
    expect(preview.root.textContent).not.toContain("can't be shown")
    preview.unmount()
  })

  it('leaves no editor behind when closed before the version arrives', async () => {
    const pending = deferred()
    const preview = mountPreview(fakeSession(() => pending.promise))

    preview.unmount()
    pending.resolve(new Response(version('<p>Late</p>')))
    await settle()
    await settle()

    expect(live.size).toBe(0)
  })

  it('keeps one editor when the user goes back to a version while it still loads', async () => {
    const requests: ReturnType<typeof deferred>[] = []
    const preview = mountPreview(
      fakeSession(() => {
        const request = deferred()
        requests.push(request)
        return request.promise
      }),
      1,
    )
    preview.shown.value = 2
    await nextTick()
    preview.shown.value = 1
    await nextTick()

    requests[0].resolve(new Response(version('<p>First</p>')))
    await settle()
    requests[2].resolve(new Response(version('<p>First again</p>')))
    requests[1].resolve(new Response(version('<p>Second</p>')))
    await vi.waitFor(() => expect(preview.root.textContent).toContain('First again'))
    await settle()

    expect(live.size).toBe(1)
    expect(preview.root.textContent).not.toContain('Second')
    preview.unmount()
    expect(live.size).toBe(0)
  })
})
