import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import MailRow from '@/apps/mail/components/MailRow.vue'

vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  const stub = (name: string) => defineComponent({ name, render: () => null })
  return { Avatar: stub('Avatar'), Checkbox: stub('Checkbox') }
})
vi.mock('@/apps/mail/components/MailDate.vue', async () => {
  const { defineComponent, h: render } = await import('vue')
  return { default: defineComponent({ render: () => render('time', 'Nov 6') }) }
})
vi.mock('@/apps/mail/utils/composables', async () => {
  const { ref } = await import('vue')
  return { useScreenSize: () => ({ isMobile: ref(false) }) }
})

// The wide layout: the reading pane off, on a desktop.
const markup = (hasExtra: boolean) => {
  const el = document.createElement('div')
  const app = createApp({
    render: () =>
      h(
        MailRow,
        { isSelected: false, datetime: '2026-11-06T10:00:00Z', hasExtra },
        {
          sender: () => 'Dana',
          subject: () => 'Brief',
          preview: () => 'See the brief.',
          extra: () => (hasExtra ? h('span', { class: 'pill' }, 'brief.pdf') : null),
          trailing: () => h('button', 'Star'),
        },
      ),
  })
  app.provide('$user', { data: { show_reading_pane: false } })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(el)
  mounted.push(app)
  return { el, html: el.innerHTML }
}

const mounted: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
})

describe('pills on their own line', () => {
  it('leaves a row with no pills one wide line, with nothing under it', () => {
    const { el } = markup(false)
    const preview = el.querySelector('h5')!.parentElement!

    expect(preview.parentElement!.classList.contains('grid')).toBe(false)
    expect(preview.nextElementSibling).toBeNull()
  })

  it('gives a row with pills a line of its own under the subject and preview', () => {
    const { el } = markup(true)
    const pill = el.querySelector('.pill')!
    const preview = el.querySelector('h5')!.parentElement!

    expect(preview.contains(pill)).toBe(false)
    expect(pill.parentElement!.parentElement).toBe(preview.parentElement)
  })
})

// A mail with no text to preview says so in a lighter gray than a real preview. Both classes on the
// one line, the stylesheet's order would decide, and the darker one wins there.
describe('the preview line', () => {
  const preview = (previewPlaceholder: boolean) => {
    const el = document.createElement('div')
    const app = createApp({
      render: () =>
        h(
          MailRow,
          { isSelected: false, datetime: '2026-11-06T10:00:00Z', previewPlaceholder },
          { sender: () => 'Dana', subject: () => 'Brief', preview: () => 'No preview' },
        ),
    })
    app.provide('$user', { data: { show_reading_pane: true } })
    app.config.globalProperties.__ = (text: string) => text
    app.mount(el)
    mounted.push(app)
    return el.querySelector('h5')!.classList
  }

  it('is muted, and only muted, when it stands in for a missing preview', () => {
    const classes = preview(true)
    expect(classes.contains('text-ink-gray-4')).toBe(true)
    expect(classes.contains('text-ink-gray-5')).toBe(false)
  })

  it('keeps the usual gray for a real preview', () => {
    const classes = preview(false)
    expect(classes.contains('text-ink-gray-5')).toBe(true)
    expect(classes.contains('text-ink-gray-4')).toBe(false)
  })
})
