import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import SharePicker from './SharePicker.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Checkbox')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Combobox')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Select')),
}))

// The people directory: two users, whatever is typed.
vi.mock('@/platform/transport', async (actual) => ({
  ...(await actual<typeof import('@/platform/transport')>()),
  transport: {
    request: async () => ({
      rows: [
        { kind: 'user', email: 'maya@example.com', full_name: 'Maya Fernandes' },
        { kind: 'user', email: 'leah@example.com', full_name: 'Leah Thomas' },
      ],
    }),
  },
}))

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())
// jsdom has no scrolling; the list scrolls the highlighted row into view.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  return () => delete (Element.prototype as Partial<Element>).scrollIntoView
})

function mountPicker() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () => h(SharePicker, { nodeKind: 'file', share: async () => [] }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root.querySelector<HTMLInputElement>('input[aria-label="Add people, groups or emails"]')!
}

async function type(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return vi.waitFor(() => {
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.length).toBeGreaterThan(0)
    return options
  })
}

/** A pointer pick: the browser moves focus to the row before the click lands. */
function clickRow(options: HTMLElement[], label: string) {
  const row = options.find((option) => option.textContent?.includes(label))!
  row.tabIndex = -1
  row.focus()
  row.click()
}

const staged = () =>
  [...document.querySelectorAll('[aria-label="People to add"] li')].map((item) =>
    item.textContent?.trim(),
  )

describe('Share picker', () => {
  it('keeps the search box focused after a pick, so the next person can be typed', async () => {
    const input = mountPicker()

    clickRow(await type(input, 'ma'), 'Maya Fernandes')
    await vi.waitFor(() => {
      expect(staged()).toEqual(['Maya Fernandes'])
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('')
    })

    clickRow(await type(input, 'le'), 'Leah Thomas')
    await vi.waitFor(() => expect(staged()).toEqual(['Maya Fernandes', 'Leah Thomas']))
    expect(document.activeElement).toBe(input)
  })
})
