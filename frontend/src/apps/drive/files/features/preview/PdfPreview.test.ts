import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import PdfPreview from './PdfPreview.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Spinner')),
}))

// A three-page PDF. Drawing a page records its number.
const pdf = vi.hoisted(() => {
  const drawn: number[] = []
  const page = (number: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => {
      drawn.push(number)
      return { promise: Promise.resolve() }
    },
  })
  const document = { numPages: 3, getPage: async (number: number) => page(number) }
  const getDocument = vi.fn((_src: string) => ({
    promise: Promise.resolve(document),
    destroy: async () => {},
  }))
  return { drawn, getDocument }
})
vi.mock('@/platform/pdf', () => ({ pdfjs: { getDocument: pdf.getDocument } }))

/** Every page is on screen at once. */
class ShownObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [fromPartial<IntersectionObserverEntry>({ target, isIntersecting: true })],
      fromPartial<IntersectionObserver>(this),
    )
  }
  unobserve() {}
  disconnect() {}
}

function viewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: width <= 767,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  vi.unstubAllGlobals()
  pdf.drawn.length = 0
  pdf.getDocument.mockClear()
})

function show() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(PdfPreview, {
        src: '/files/report.pdf',
        download: '/files/report.pdf?download=1',
        title: 'Report',
      }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root
}

describe('PDF preview', () => {
  it('draws each page on a phone', async () => {
    viewport(390)
    vi.stubGlobal('IntersectionObserver', ShownObserver)
    const root = show()

    await vi.waitFor(() => expect(pdf.drawn).toEqual([1, 2, 3]))
    const pages = [...root.querySelectorAll('canvas')].map((page) =>
      page.getAttribute('aria-label'),
    )
    expect(pages).toEqual(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3'])
    expect(pdf.getDocument).toHaveBeenCalledWith('/files/report.pdf')
    expect(root.querySelector('iframe')).toBeNull()
  })

  it('shows the PDF in a frame on a wide screen, without loading pdf.js', () => {
    viewport(1280)
    const root = show()

    expect(root.querySelector('iframe')?.getAttribute('src')).toBe('/files/report.pdf')
    expect(pdf.getDocument).not.toHaveBeenCalled()
  })

  it('offers the file in a new tab and as a download when a phone cannot draw it', async () => {
    viewport(390)
    pdf.getDocument.mockReturnValueOnce({
      promise: Promise.reject(new Error('Invalid PDF structure')),
      destroy: async () => {},
    })
    const root = show()

    const links = await vi.waitFor(() => {
      const found = [...root.querySelectorAll('a')].map((link) => [
        link.textContent?.trim(),
        link.getAttribute('href'),
      ])
      expect(found.length).toBe(2)
      return found
    })
    expect(links).toEqual([
      ['Open in new tab', '/files/report.pdf'],
      ['Download', '/files/report.pdf?download=1'],
    ])
  })
})
