import { describe, expect, it, vi } from 'vitest'

import { uploadEmbeddedImages } from '@/apps/mail/utils/embeddedImages'

vi.mock('@/apps/mail/utils', () => ({ randomString: () => 'cid1' }))

// A 1×1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('uploadEmbeddedImages', () => {
  it('uploads an image held as a data URL and points the body at its file, ready to go inline', async () => {
    const uploaded: File[] = []
    const upload = async (file: File) => {
      uploaded.push(file)
      return { file_url: '/private/files/image.png' }
    }

    const body = await uploadEmbeddedImages(`<div>See this:</div><img src="${PNG}">`, upload)

    expect(uploaded.map((file) => [file.name, file.type, file.size])).toEqual([
      ['image.png', 'image/png', 68],
    ])
    const image = new DOMParser().parseFromString(body, 'text/html').querySelector('img')!
    expect(image.getAttribute('src')).toBe('/private/files/image.png')
    expect(image.getAttribute('data-cid')).toBe('cid1')
    expect(body).toContain('<div>See this:</div>')
  })

  it('leaves a body without data URLs exactly as it was', async () => {
    const upload = vi.fn()
    const html = '<div>Hi</div><img src="/private/files/a.png" data-cid="x">'

    expect(await uploadEmbeddedImages(html, upload)).toBe(html)
    expect(upload).not.toHaveBeenCalled()
  })
})
