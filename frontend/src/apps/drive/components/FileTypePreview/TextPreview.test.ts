import { createApp, defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TextPreview from './TextPreview.vue'

vi.mock('./FilePreviewSkeleton.vue', () => ({
  default: defineComponent({ template: '<div data-testid="skeleton" />' }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

function mountPreview(name: string) {
  const root = document.createElement('div')
  const app = createApp(
    defineComponent({
      setup: () => () => h(TextPreview, { previewEntity: { name } }),
    }),
  )
  app.mount(root)
  return { app, root }
}

describe('Drive TextPreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches and renders the initial file content', async () => {
    const request = deferred<Response>()
    const fetchMock = vi.fn(() => request.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { app, root } = mountPreview('file-a')
    await nextTick()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/method/suite.drive.api.files.get_file_content?entity_name=file-a',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Range: 'bytes=0-10000000' }),
      }),
    )

    request.resolve({
      ok: true,
      blob: async () => ({ text: async () => 'initial content' }),
    } as Response)
    await flushPromises()

    expect(root.querySelector('pre')?.textContent).toContain('initial content')
    app.unmount()
  })
})
