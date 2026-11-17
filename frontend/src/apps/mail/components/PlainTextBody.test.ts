import { describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import PlainTextBody from '@/apps/mail/components/PlainTextBody.vue'

// Sent on Monday 16 November 2026.
const sentAt = '2026-11-16T09:00:00Z'

const mount = (text: string, props: Record<string, unknown> = {}) => {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(PlainTextBody, { text, ...props })
  app.config.globalProperties.__ = (message: string) => message
  app.mount(root)
  return root
}
const marks = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[role="button"]')].map((mark) => mark.textContent)

describe('dates in a mail sent as text', () => {
  const text =
    'Can we meet Thursday at 3pm? Notes at https://example.com/tomorrow-10:30\n\n' +
    'On Mon, 16 Nov 2026 at 09:00, Lena wrote:\n> Friday 10am works?'

  it('marks the dates in the writer’s own words, not in a link, the quote or its lead line', async () => {
    const root = mount(text, { sentAt })
    await vi.waitFor(() => expect(marks(root)).toEqual(['Thursday at 3pm']))
    // The words read as they did.
    expect(root.textContent).toContain('Can we meet Thursday at 3pm? Notes at')
  })

  it('asks for an event at the date picked', async () => {
    const onPickDate = vi.fn()
    const root = mount(text, { sentAt, onPickDate })
    await vi.waitFor(() => expect(marks(root)).toHaveLength(1))
    root.querySelector<HTMLElement>('[role="button"]')!.click()
    expect(onPickDate).toHaveBeenCalledWith(
      expect.objectContaining({ start: { date: '2026-11-19', time: expect.any(String) } }),
    )
  })

  it('marks nothing when it is not offered as an event', async () => {
    const root = mount(text)
    await nextTick()
    expect(marks(root)).toEqual([])
  })
})
