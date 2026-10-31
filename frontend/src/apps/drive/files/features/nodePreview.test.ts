import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'

import { createPreviewMemory, useNodePreview, type PreviewNode } from './nodePreview'

function image(url: string | null): PreviewNode {
  return reactive({
    name: 'photo',
    kind: 'File',
    content_doctype: null,
    preview: url ? { url, expires: 0 } : null,
  })
}

describe('a card thumbnail', () => {
  it('keeps the icon for a presentation, even when it has a preview', () => {
    const node = reactive<PreviewNode>({
      name: 'deck',
      kind: 'document',
      content_doctype: 'Presentation',
      preview: { url: '/p/deck.webp', expires: 0 },
    })
    const preview = useNodePreview(() => node, createPreviewMemory())

    expect(preview.url.value).toBeUndefined()
    expect(preview.shown.value).toBe(false)
  })

  it('shows the image once it has loaded, not before', () => {
    const node = image('/p/photo.webp?s=1')
    const preview = useNodePreview(() => node, createPreviewMemory())

    expect(preview.url.value).toBe('/p/photo.webp?s=1')
    expect(preview.shown.value).toBe(false)
    preview.loaded()
    expect(preview.shown.value).toBe(true)
  })

  it('falls back to the icon when the image fails, and asks for one refetch', () => {
    const node = image('/p/photo.webp?s=1')
    const preview = useNodePreview(() => node, createPreviewMemory())

    expect(preview.failed()).toBe(true)
    expect(preview.url.value).toBeUndefined()
    expect(preview.shown.value).toBe(false)

    // The refetch brings a new URL, which fails too: no second refetch.
    node.preview = { url: '/p/photo.webp?s=2', expires: 0 }
    expect(preview.url.value).toBe('/p/photo.webp?s=2')
    expect(preview.failed()).toBe(false)
    expect(preview.url.value).toBeUndefined()
  })

  it('keeps showing the image when a refetch signs a new URL', () => {
    const node = image('/p/photo.webp?s=1')
    const preview = useNodePreview(() => node, createPreviewMemory())
    preview.loaded()

    node.preview = { url: '/p/photo.webp?s=2', expires: 0 }
    expect(preview.url.value).toBe('/p/photo.webp?s=2')
    expect(preview.shown.value).toBe(true)
  })

  it('shows a loaded image at once on a card mounted again, as after going Back', () => {
    const memory = createPreviewMemory()
    const node = image('/p/photo.webp?s=1')
    useNodePreview(() => node, memory).loaded()

    expect(useNodePreview(() => node, memory).shown.value).toBe(true)
    // An unseen URL is not in the browser's cache, so a new card waits for it.
    node.preview = { url: '/p/photo.webp?s=2', expires: 0 }
    expect(useNodePreview(() => node, memory).shown.value).toBe(false)
  })
})
