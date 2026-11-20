import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'

import SlideContainer from '@/apps/slides/components/SlideContainer.vue'
import { slideIndex, slides } from '@/apps/slides/stores/slide'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

// DOMMatrix isn't in the test DOM, and where the slide sits is not what this checks
vi.mock('@/apps/slides/composables/usePanAndZoom', async () => {
  const { ref } = await import('vue')
  return {
    usePanAndZoom: () => ({
      baseScale: ref(1),
      transform: ref(''),
      transformOrigin: ref(''),
      allowPanAndZoom: ref(false),
      isPanningOrZooming: ref(false),
    }),
  }
})

const FAILED_NOTE = "Couldn't load this slide. Reload to try again."

let app: App | null = null

async function drawnSlideText(compositePlaceholder?: string) {
  slides.value = [{ clientId: 'one', background: '#ffffffff', elements: [], compositePlaceholder }]
  slideIndex.value = 0
  const root = document.body.appendChild(document.createElement('div'))
  app = createApp(SlideContainer)
  app.mount(root)
  await nextTick()
  return root.textContent
}

describe('a linked presentation slide that stands in for its source', () => {
  afterEach(() => {
    app?.unmount()
    app = null
    document.body.replaceChildren()
    slides.value = []
  })

  it('says the slide could not load once the load really failed', async () => {
    expect(await drawnSlideText('failed')).toContain(FAILED_NOTE)
  })

  it.each(['loading', 'unreadable', undefined])('says nothing when it is %s', async (status) => {
    expect(await drawnSlideText(status)).not.toContain(FAILED_NOTE)
  })
})
