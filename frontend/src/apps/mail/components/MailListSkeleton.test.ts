import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

import MailListSkeleton from '@/apps/mail/components/MailListSkeleton.vue'
import MailRow from '@/apps/mail/components/MailRow.vue'

const isMobile = ref(false)

vi.mock('frappe-ui', async () => {
  const { defineComponent, h: render } = await import('vue')
  return {
    Avatar: defineComponent({
      name: 'Avatar',
      render: () => render('span', { 'data-avatar': '' }),
    }),
    Checkbox: defineComponent({
      name: 'Checkbox',
      render: () => render('input', { type: 'checkbox' }),
    }),
  }
})
vi.mock('@/apps/mail/components/MailDate.vue', async () => {
  const { defineComponent, h: render } = await import('vue')
  return { default: defineComponent({ render: () => render('time', 'Nov 6') }) }
})
vi.mock('@/apps/mail/utils/composables', () => ({ useScreenSize: () => ({ isMobile }) }))

const mounted: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
  isMobile.value = false
})

type Setting = { readingPane: boolean; selectable?: boolean; hideAvatar?: boolean }

const mount = (render: () => ReturnType<typeof h>, readingPane: boolean) => {
  const el = document.createElement('div')
  const app = createApp({ render })
  app.provide('$user', { data: { show_reading_pane: readingPane } })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(el)
  mounted.push(app)
  return el
}

const outlineRow = ({ readingPane, ...props }: Setting) =>
  mount(() => h(MailListSkeleton, props), readingPane).querySelector<HTMLElement>(
    '[role=status] > div',
  )!

// SAFETY: MailRow with no `to` renders one div as its root, the mount point's only child.
const mailRow = ({ readingPane, ...props }: Setting) =>
  mount(
    () =>
      h(
        MailRow,
        { isSelected: false, avatarLabel: 'Dana', datetime: '2026-11-06T10:00:00Z', ...props },
        { sender: () => 'Dana', subject: () => 'Brief', preview: () => 'See the brief.' },
      ),
    readingPane,
  ).firstElementChild as HTMLElement

// A row's height comes from its vertical padding; the outline must take the same.
const padding = (el: HTMLElement) => [...el.classList].filter((c) => /(^|:|!)py-/.test(c)).sort()

// What a row's leading column shows: a checkbox, an avatar, or no column at all.
const leading = (row: HTMLElement) => {
  // In the outline, a checkbox's place is a small square and an avatar's a circle.
  if (row.querySelector('input[type=checkbox], .h-4.w-4')) return 'checkbox'
  const avatar = row.querySelector<HTMLElement>('[data-avatar], .rounded-full')
  return avatar && avatar.style.display !== 'none' ? 'avatar' : 'none'
}

describe('a loading list takes the shape of its rows', () => {
  it('is one line per row, at a row height, with the reading pane off', () => {
    const outline = outlineRow({ readingPane: false })
    const row = mailRow({ readingPane: false })

    expect(padding(outline)).toEqual(padding(row))
    // The date leaves the sender line for a column of its own at the row's end.
    expect(outline.children.length).toBe(row.children.length)
  })

  it('is a stacked block per row beside the reading pane', () => {
    const outline = outlineRow({ readingPane: true })
    const row = mailRow({ readingPane: true })

    expect(padding(outline)).toEqual(padding(row))
    expect(outline.children.length).toBe(row.children.length)
  })

  const lists: [string, Setting, boolean][] = [
    ['a folder on a desktop', { readingPane: true }, false],
    ['a folder on a desktop, reading pane off', { readingPane: false }, false],
    ['All Inboxes on a desktop', { readingPane: true, hideAvatar: true }, false],
    ['an all-accounts search on a desktop', { readingPane: true, selectable: false }, false],
    ['a folder on a phone', { readingPane: true }, true],
    ['All Inboxes on a phone', { readingPane: true, hideAvatar: false }, true],
  ]

  it.each(lists)('leads %s with what its rows lead with', (_, setting, phone) => {
    isMobile.value = phone
    expect(leading(outlineRow(setting))).toBe(leading(mailRow(setting)))
  })

  it('draws no avatar where the rows show none', () => {
    const setting = { readingPane: true, hideAvatar: true, selectable: false }
    expect(leading(mailRow(setting))).toBe('none')
    expect(leading(outlineRow(setting))).toBe('none')
  })

  it('keeps the avatar on a phone', () => {
    isMobile.value = true
    expect(leading(outlineRow({ readingPane: true }))).toBe('avatar')
  })
})
