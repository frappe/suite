import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, provide, type App } from 'vue'

import ImageElement from '@/apps/slides/components/ImageElement.vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({
  getAttachmentUrl: (src: string) => `own:${src}`,
  MEDIA_UPLOAD_ENDPOINT: '',
}))

let app: App | undefined

afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

async function drawn(templateMediaUrl?: (id: string) => string) {
  const page = document.createElement('div')
  document.body.append(page)
  const element = { id: 'photo-1', type: 'image', src: 'photo', width: 200, height: 100 }
  app = createApp({
    setup() {
      if (templateMediaUrl) {
        provide('templateMediaUrl', templateMediaUrl)
      }
      return () => h(ImageElement, { element, mode: 'thumbnail' })
    },
  })
  app.mount(page)
  await nextTick()

  return page.querySelector('img')?.getAttribute('src')
}

describe('the url a picture is drawn from', () => {
  it("is the open presentation's", async () => {
    expect(await drawn()).toBe('own:photo')
  })

  it("is the template's in a template picker", async () => {
    expect(await drawn((id) => `template:${id}`)).toBe('template:photo')
  })

  it("is the open presentation's for a picture the template does not hold", async () => {
    expect(await drawn(() => '')).toBe('own:photo')
  })
})
