import { describe, expect, it } from 'vitest'

import { imagePrintDocument } from '@/apps/mail/utils/html'

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')

// The sender chooses an attachment's filename, and the print page runs as this site: markup in
// the name used to close the <title> and run as the signed-in user.
describe('imagePrintDocument', () => {
  it('keeps a filename with markup in it as the title text', () => {
    const filename = 'photo.png</title><img src=x onerror="alert(1)">'
    const doc = parse(imagePrintDocument(filename, '/preview/1'))

    expect(doc.title).toBe(filename)
    expect(doc.querySelectorAll('img')).toHaveLength(1)
    expect(doc.querySelector('[onerror]')).toBeNull()
  })

  it('shows the image it was given', () => {
    const doc = parse(imagePrintDocument('photo.png', '/preview/1?a=1&b=2'))

    expect(doc.querySelector('img')?.getAttribute('src')).toBe('/preview/1?a=1&b=2')
  })

  it('keeps a quote in the src from adding attributes', () => {
    const doc = parse(imagePrintDocument('photo.png', '/preview/1" onerror="alert(1)'))

    expect(doc.querySelector('img')?.getAttribute('onerror')).toBeNull()
  })
})
