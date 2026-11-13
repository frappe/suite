import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('frappe-ui', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }))
vi.mock('@/apps/slides/router', () => ({ router: { currentRoute: { value: { query: {} } } } }))
vi.mock('@/apps/slides/stores/slide', () => ({}))
vi.mock('@/apps/slides/stores/historyMeta', () => ({}))
vi.mock('@/apps/slides/stores/element', () => ({}))

const { presentationDoc, presentationTheme, templateList } = await import('./presentation')

describe('the theme a presentation adds slides from', () => {
  beforeEach(() => {
    templateList.value = [
      fromPartial({ name: 'T-dark', title: 'Dark' }),
      fromPartial({ name: 'T-light', title: 'Light' }),
    ]
  })

  it('is the presentation’s own theme', () => {
    presentationDoc.value = { theme: 'T-dark' }

    expect(presentationTheme.value).toBe('T-dark')
  })

  it('is Light for a presentation with no theme', () => {
    presentationDoc.value = { theme: null }

    expect(presentationTheme.value).toBe('T-light')
  })

  it('is Light when the theme is not among the templates', () => {
    presentationDoc.value = { theme: 'T-gone' }

    expect(presentationTheme.value).toBe('T-light')
  })
})
