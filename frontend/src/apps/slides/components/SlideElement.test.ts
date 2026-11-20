import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'

import SlideElement from '@/apps/slides/components/SlideElement.vue'
import { withOverride } from '@/platform/theme'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

let app: App | undefined

async function drawText(content: string) {
  const page = document.createElement('div')
  // The app's own ink, which the slide must not pick up
  page.style.color = '#171717'
  document.body.append(page)
  const element = { id: 'text-1', type: 'text', content, left: 0, top: 0, width: 200 }
  app = createApp({ render: () => h(SlideElement, { element, mode: 'thumbnail' }) })
  app.mount(page)
  await nextTick()

  return page
}

let releaseDark: (() => void) | undefined

afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  releaseDark?.()
  releaseDark = undefined
})

describe('the colour of text on a slide', () => {
  it('draws text with no saved colour in black', async () => {
    const page = await drawText('<p>Plain</p>')

    const text = page.querySelector('p')!
    expect(text.textContent).toBe('Plain')
    expect(getComputedStyle(text).color).toBe('rgb(0, 0, 0)')
  })

  it('draws text with no saved colour in black in dark mode too', async () => {
    releaseDark = withOverride('dark')
    const page = await drawText('<p>Plain</p>')
    // dark mode's light ink
    page.style.color = '#f8f8f8'

    expect(getComputedStyle(page.querySelector('p')!).color).toBe('rgb(0, 0, 0)')
  })

  it('keeps a saved colour', async () => {
    const page = await drawText('<p><span style="color: rgb(200, 30, 40)">Red</span></p>')

    const span = page.querySelector('span[style]')!
    expect(span.textContent).toBe('Red')
    expect(getComputedStyle(span).color).toBe('rgb(200, 30, 40)')
  })
})
