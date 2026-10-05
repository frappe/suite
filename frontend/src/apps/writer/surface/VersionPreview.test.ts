import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'

import VersionPreview from './VersionPreview.vue'

const version = (html: string) =>
  JSON.stringify({ schema: 'writer-document/1', content: 'AAA=', html, collab: 0 })

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

afterEach(() => {
  vi.unstubAllGlobals()
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
})
