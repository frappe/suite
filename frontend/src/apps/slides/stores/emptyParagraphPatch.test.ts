import { describe, expect, it, vi } from 'vitest'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { patchEmptyParagraphs } = await import('./tiptapSetup')

const styled = (text: string) =>
  `<span style="font-size: 24px; color: rgb(255, 0, 0)">${text}</span>`

const cell = (inner: string) => `<td colspan="1" rowspan="1">${inner}</td>`

const table = (...cells: string[]) =>
  `<table style="min-width: 50px"><colgroup><col style="width: 100px"><col style="width: 100px"></colgroup><tbody><tr>${cells.join('')}</tr></tbody></table>`

describe('patchEmptyParagraphs', () => {
  it('styles an empty paragraph after a styled one', () => {
    const html = `<p>${styled('Title')}</p><p></p>`

    const { wasUpdated, updatedHTML } = patchEmptyParagraphs(html)

    expect(wasUpdated).toBe(true)
    const rendered = document.createElement('div')
    rendered.innerHTML = updatedHTML
    const inheritedStyle = rendered.querySelector<HTMLElement>('p + p span')!
    expect(inheritedStyle.style.fontSize).toBe('24px')
    expect(inheritedStyle.style.color).toBe('rgb(255, 0, 0)')
  })

  it('does not bleed styles across table cells', () => {
    const html = table(cell(`<p>${styled('Filled')}</p>`), cell('<p></p>'))

    const { wasUpdated, updatedHTML } = patchEmptyParagraphs(html)

    expect(wasUpdated).toBe(false)
    expect(updatedHTML).toBe(html)
  })
})
