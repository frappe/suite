import { getSchema } from '@tiptap/core'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, shallowRef } from 'vue'
import { Doc, encodeStateAsUpdate, XmlElement, XmlText } from 'yjs'

import type { DocumentSession } from '@/apps/drive'
import { BODY_FIELD } from '@/apps/writer/collab'
import { writerSchema } from '@/apps/writer/schema'

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

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

// A server version whose first tab is renamed and whose tabs are stored out of display order
async function tabbedVersion() {
  const content = [
    paragraph('first'),
    { type: 'tab', attrs: { id: 'b', label: 'Later', order: 1 }, content: [paragraph('bee')] },
    { type: 'tab', attrs: { id: 'a', label: 'Sooner', order: 0 }, content: [paragraph('ay')] },
  ]
  const ydoc = prosemirrorJSONToYDoc(getSchema(writerSchema()), { type: 'doc', content }, 'default')
  ydoc.getMap('meta').set('firstTabLabel', 'Intro')
  return stateVersion(ydoc)
}

// A version the old editor saved, holding an image of the kind only it had
function oldImageVersion() {
  const ydoc = new Doc()
  const text = new XmlElement('paragraph')
  text.insert(0, [new XmlText('before')])
  const image = new XmlElement('resizableMedia')
  image.setAttribute('src', '/files/chart.png')
  image.setAttribute('media-type', 'img')
  ydoc.getXmlFragment(BODY_FIELD).insert(0, [text, image])
  return stateVersion(ydoc)
}

async function stateVersion(ydoc: Doc) {
  const update = new Response(new Uint8Array(encodeStateAsUpdate(ydoc))).body!
  const zipped = await new Response(update.pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  const stored = {
    schema: 'writer-document/2',
    codec: 'yjs1',
    lineage: 'lineage-1',
    state: btoa(String.fromCharCode(...new Uint8Array(zipped))),
    html: null,
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
  const exposed = shallowRef<InstanceType<typeof VersionPreview> | null>(null)
  const root = document.createElement('div')
  document.body.append(root)
  const render = () => {
    const props = {
      session,
      seq: shownSeq.value,
      settings: {},
    }
    return h(VersionPreview, { ...props, ref: exposed })
  }
  const app = createApp({ setup: () => render })
  app.mount(root)

  return {
    root,
    shownSeq,
    versionHTML: () => exposed.value?.versionHTML(),
    isShown: () => exposed.value?.isShown,
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

  it('shows a version that ends in a tab without an added empty line', async () => {
    const html = '<p>Intro</p><div data-tab-id="t" data-tab-label="Notes"><p>Tab text</p></div>'
    const session = fakeSession(async () => new Response(storedVersion(html)))
    const preview = mountPreview(session)

    await vi.waitFor(() => expect(preview.root.textContent).toContain('Tab text'))
    await settle()

    expect(preview.root.querySelectorAll('p')).toHaveLength(2)
    preview.unmount()
  })

  it("says a version that can't be read can't be shown", async () => {
    const session = fakeSession(async () => new Response(null, { status: 500 }))
    const preview = mountPreview(session)

    await vi.waitFor(() =>
      expect(preview.root.textContent).toContain("This version can't be shown."),
    )
    expect(preview.root.querySelector('[aria-label="Version preview"]')).toBeNull()
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

  it('gives the shown version as the live document exports all its tabs', async () => {
    const stored = await tabbedVersion()
    const preview = mountPreview(fakeSession(async () => new Response(stored)))

    await vi.waitFor(() => expect(preview.root.textContent).toContain('bee'))

    expect(preview.versionHTML()).toBe(
      '<div data-tab-id="first-tab" data-tab-label="Intro"><p>first</p></div>' +
        '<div data-tab-id="a" data-tab-label="Sooner" data-tab-order="0"><p>ay</p></div>' +
        '<div data-tab-id="b" data-tab-label="Later" data-tab-order="1"><p>bee</p></div>',
    )
    preview.unmount()
  })

  it('shows a version holding an old image, so it can be downloaded and restored', async () => {
    const stored = await oldImageVersion()
    const preview = mountPreview(fakeSession(async () => new Response(stored)))

    await vi.waitFor(() => expect(preview.root.textContent).toContain('before'))
    await settle()

    expect(preview.root.textContent).not.toContain("can't be shown")
    expect(preview.isShown()).toBe(true)
    expect(preview.versionHTML()).toContain('<img src="/files/chart.png"')
    preview.unmount()
  })

  it('gives no version HTML while the next version loads or when it fails', async () => {
    const requests: ReturnType<typeof deferred>[] = []
    const preview = mountPreview(heldSession(requests))
    requests[0].resolve(new Response(storedVersion('<p>First</p>')))
    await vi.waitFor(() => expect(preview.versionHTML()).toBe('<p>First</p>'))

    preview.shownSeq.value = 2
    await settle()
    const whileLoading = preview.versionHTML()
    requests[1].resolve(new Response(null, { status: 500 }))
    await vi.waitFor(() => expect(preview.root.textContent).toContain("can't be shown"))

    expect([whileLoading, preview.versionHTML()]).toEqual([null, null])
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
