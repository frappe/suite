import { describe, expect, it } from 'vitest'

import { imagePrintDocument } from '@/apps/mail/utils/html'

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')

// A filename can hold any characters, < and > among them. The page shows it as written.
describe('imagePrintDocument', () => {
  it('shows a filename with angle brackets in it as the title, as written', () => {
    const filename = 'photo.png</title><b>notes</b>'
    const doc = parse(imagePrintDocument(filename, '/preview/1'))

    expect(doc.title).toBe(filename)
    expect(doc.querySelector('b')).toBeNull()
  })

  it('shows the image it was given', () => {
    const doc = parse(imagePrintDocument('photo.png', '/preview/1?a=1&b=2'))

    expect(doc.querySelector('img')?.getAttribute('src')).toBe('/preview/1?a=1&b=2')
  })

  it('keeps a quote in the src inside the src', () => {
    const src = '/preview/1" data-x="1'
    const doc = parse(imagePrintDocument('photo.png', src))

    expect(doc.querySelector('img')?.getAttribute('src')).toBe(src)
  })
})
