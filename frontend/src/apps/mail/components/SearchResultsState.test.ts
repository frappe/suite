import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import SearchResultsState from './SearchResultsState.vue'

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function render(props: Record<string, unknown>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ setup: () => () => h(SearchResultsState, props) })
  app.config.globalProperties.__ = (text: string, args?: string[]) =>
    args ? text.replace('{0}', args[0]) : text
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root
}
// frappe-ui's Button is stubbed under test, leaving its label on the element.
const button = (root: Element, label: string) =>
  root.querySelector<HTMLButtonElement>(`button[label="${label}"]`)

describe('SearchResultsState', () => {
  it('offers a retry when the search failed, not advice about the words', () => {
    const onRetry = vi.fn()
    const root = render({ failed: true, text: 'budget', canClearFilters: true, onRetry })

    expect(root.textContent).toContain("Couldn't search")
    expect(root.textContent).not.toContain('No mail matches')
    expect(button(root, 'Remove filters')).toBeNull()

    button(root, 'Try again')!.click()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('explains whole-word search when words found nothing', () => {
    const root = render({ text: 'zebra' })

    expect(root.textContent).toContain('No mail matches "zebra"')
    expect(root.textContent).toContain('whole words')
  })

  it('has no word advice for a search by filters alone', () => {
    const root = render({ canClearFilters: true })

    expect(root.textContent).toContain('No mail matches these filters')
    expect(root.textContent).not.toContain('whole words')
  })

  it('offers only the ways on that exist', () => {
    const onClearFilters = vi.fn()
    const onWiden = vi.fn()
    const narrow = render({ text: 'zebra', canClearFilters: true, onClearFilters })
    expect(button(narrow, 'Search all accounts')).toBeNull()
    button(narrow, 'Remove filters')!.click()
    expect(onClearFilters).toHaveBeenCalledOnce()
    cleanup?.()

    const wide = render({ text: 'zebra', canWiden: true, onWiden })
    expect(button(wide, 'Remove filters')).toBeNull()
    button(wide, 'Search all accounts')!.click()
    expect(onWiden).toHaveBeenCalledOnce()
  })
})
