import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import MailRow from '@/apps/mail/components/MailRow.vue'

vi.mock('frappe-ui', async () => {
  const { defineComponent, h: render } = await import('vue')
  return {
    Avatar: defineComponent({ render: () => render('span', { class: 'avatar' }) }),
    Checkbox: defineComponent({ render: () => null }),
  }
})
vi.mock('@/apps/mail/components/MailDate.vue', async () => {
  const { defineComponent } = await import('vue')
  return { default: defineComponent({ render: () => null }) }
})
vi.mock('@/apps/mail/utils/composables', async () => {
  const { ref } = await import('vue')
  return { useScreenSize: () => ({ isMobile: ref(true) }) }
})

const mounted: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
})

// A phone row, ticked or not.
const row = (isSelected: boolean) => {
  const el = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MailRow, {
        isSelected,
        selectionMode: true,
        avatarLabel: 'Dana',
        selectLabel: 'Select Dana',
        datetime: '2026-11-06T10:00:00Z',
      }),
  })
  app.provide('$user', { data: { show_reading_pane: false } })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(el)
  mounted.push(app)
  const avatar = el.querySelector<HTMLElement>('.avatar')
  return {
    avatarShown: !!avatar && avatar.parentElement?.style.display !== 'none',
    ticked: !!avatar?.parentElement?.querySelector('svg'),
  }
}

it('keeps the sender in view on a phone, ticking the avatar of a selected row', () => {
  expect(row(true)).toEqual({ avatarShown: true, ticked: true })
  expect(row(false)).toEqual({ avatarShown: true, ticked: false })
})
