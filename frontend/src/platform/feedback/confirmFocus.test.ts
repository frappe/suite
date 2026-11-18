import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import { confirm, FeedbackProvider } from '.'

// The real dialogs, not the test stand-in, so focus lands where a browser puts it.
vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../node_modules/frappe-ui/src/utils/dialog')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/FrappeUIProvider')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Toast/toast')),
}))

let unmount: (() => void) | undefined

afterEach(() => {
  unmount?.()
  unmount = undefined
  document.body.innerHTML = ''
})

/** Opens a real confirm dialog and answers the text of the element that holds focus. */
async function focusedOnOpen(options: Parameters<typeof confirm>[0]): Promise<string> {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(FeedbackProvider) })
  app.mount(host)
  unmount = () => app.unmount()
  void confirm(options)
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true),
  )
  const focused = document.activeElement
  const label = focused?.textContent?.trim() ?? ''
  // Answer it, so the next test opens the only dialog on the page.
  if (focused instanceof HTMLElement) focused.click()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  return label
}

describe('a confirm dialog', () => {
  it('opens with focus on the confirm button', async () => {
    expect(await focusedOnOpen({ title: 'Move 2 items?', confirmLabel: 'Move' })).toBe('Move')
  })

  it('opens with focus on Cancel when the action destroys something', async () => {
    expect(
      await focusedOnOpen({
        title: 'Delete forever?',
        confirmLabel: 'Delete forever',
        destructive: true,
      }),
    ).toBe('Cancel')
  })
})
