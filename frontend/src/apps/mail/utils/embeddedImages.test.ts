import { describe, expect, it, vi } from 'vitest'

import { processInlineImages } from '@/apps/mail/utils'
import { embeddedImagesIn, uploadEmbeddedImages } from '@/apps/mail/utils/embeddedImages'

// A 1×1 transparent PNG, 68 bytes.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG = `data:image/png;base64,${PNG_BASE64}`

const uploadedTo = (fileUrl: string) => {
  const uploaded: File[] = []
  const upload = async (file: File) => {
    uploaded.push(file)
    return { file_url: fileUrl }
  }
  return { uploaded, upload }
}

describe('uploadEmbeddedImages', () => {
  it('uploads an image held as a data URL, and the mail carries it as an inline attachment', async () => {
    const { uploaded, upload } = uploadedTo('/private/files/image.png')

    const html = `<div>See this:</div><img src="${PNG}">`
    const body = (await uploadEmbeddedImages(html, upload)).inHtml(html)
    const sent = processInlineImages({ html_body: body, quoted_content: '', attachments: [] })

    expect(uploaded.map((file) => [file.type, file.size])).toEqual([['image/png', 68]])
    const image = new DOMParser().parseFromString(sent.html_body, 'text/html').querySelector('img')!
    expect(sent.attachments).toEqual([
      {
        file_url: '/private/files/image.png',
        disposition: 'inline',
        cid: image.getAttribute('src')!.replace(/^cid:/, ''),
      },
    ])
    expect(image.getAttribute('src')).toMatch(/^cid:./)
    expect(sent.html_body).not.toContain('base64')
    expect(sent.html_body).toContain('<div>See this:</div>')
  })

  it('reads a data URL with parameters, and text beyond Latin-1', async () => {
    const { uploaded, upload } = uploadedTo('/private/files/image.png')
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>✓ ok</text></svg>'
    const html =
      `<img src="data:image/png;name=dot.png;base64,${PNG_BASE64}">` +
      `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`

    const uploads = await uploadEmbeddedImages(html, upload)

    expect(uploaded.map((file) => [file.type, file.size])).toEqual([
      ['image/png', 68],
      ['image/svg+xml', new TextEncoder().encode(svg).length],
    ])
    expect(await uploaded[1].text()).toBe(svg)
    expect(uploads.inHtml(html)).not.toContain('data:')
  })

  it('reads base64 written the loose ways a data URL allows, at any size', async () => {
    const { uploaded, upload } = uploadedTo('/private/files/image.png')
    const bytes = Uint8Array.from({ length: 300_000 }, (_, index) => index % 251)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    // Unpadded, a space every 20 characters, and some characters percent-encoded: `A` and `k`.
    const loose = PNG_BASE64.replace(/=+$/, '')
      .replace(/(.{20})/g, '$1 ')
      .replace(/A/g, '%41')
      .replace(/k/g, '%6b')
    const html =
      `<img src="data:image/jpeg;base64,${btoa(binary)}">` +
      `<img src="DATA:IMAGE/PNG; BASE64,${loose}">`

    await uploadEmbeddedImages(html, upload)

    expect(uploaded.map((file) => [file.name, file.type, file.size])).toEqual([
      ['image.jpeg', 'image/jpeg', 300_000],
      ['image.png', 'image/png', 68],
    ])
    expect(new Uint8Array(await uploaded[0].arrayBuffer())).toEqual(bytes)
    const png = Uint8Array.from(atob(PNG_BASE64), (character) => character.charCodeAt(0))
    expect(new Uint8Array(await uploaded[1].arrayBuffer())).toEqual(png)
  })

  it('leaves a body without data URLs exactly as it was', async () => {
    const upload = vi.fn()
    const html = '<div>Hi</div><img src="/private/files/a.png" data-cid="x">'

    expect((await uploadEmbeddedImages(html, upload)).inHtml(html)).toBe(html)
    expect(upload).not.toHaveBeenCalled()
  })

  it('says why an image was left as a data URL', async () => {
    const refusal = new Error('Server error')
    const broken = 'data:image/png;base64,not*base64'
    const html = `<img src="${PNG}"><img src="data:text/plain,hello"><img src="${broken}">`

    const uploads = await uploadEmbeddedImages(html, () => Promise.reject(refusal))

    expect([...uploads.failures]).toEqual([
      [PNG, refusal],
      ['data:text/plain,hello', undefined],
      [broken, undefined],
    ])
  })
})

describe('embeddedImagesIn', () => {
  it('finds every image still held as a data URL, by the name a person would know it by', () => {
    const html =
      `<img src="/private/files/logo.png">` +
      `<img src="data:image/png;name=floor%20plan.png;base64,${PNG_BASE64}" alt="Plan">` +
      `<img src="${PNG}" alt="Signature">` +
      `<p><img src="DATA:image/png;base64,${PNG_BASE64}"></p>`

    expect(embeddedImagesIn(html).map(({ name, position }) => [name, position])).toEqual([
      ['floor plan.png', 2],
      ['Signature', 3],
      ['', 4],
    ])
  })
})
