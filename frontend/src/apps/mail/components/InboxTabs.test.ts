import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import InboxTabs from '@/apps/mail/components/InboxTabs.vue'
import type { InboxCategory, InboxTab } from '@/apps/mail/composables/useInboxTabs'

// A button that is its route and its slots; the menu of category choices is not under test.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Button: defineComponent({
      props: { route: Object },
      setup:
        (props, { slots, attrs }) =>
        () =>
          h('a', { ...attrs, 'data-route': JSON.stringify(props.route ?? null) }, [
            slots.prefix?.(),
            slots.default?.(),
            slots.suffix?.(),
          ]),
    }),
    Badge: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          h('b', slots.default?.()),
    }),
    Dropdown: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
vi.mock('@/apps/mail/composables/useInboxTabs', async () => {
  const { computed } = await import('vue')
  return {
    useTabChoiceMenu: () => ({
      categoriesSwitch: computed(() => null),
      tabGroups: computed(() => []),
    }),
  }
})
vi.stubGlobal('__', (text: string) => text)

const tab = (category: InboxCategory, label: string, unread: number): InboxTab => ({
  category,
  label,
  icon: `lucide-${category}`,
  unread,
})
const TABS = [
  tab('primary', 'Primary', 12),
  tab('updates', 'Updates', 150),
  tab('promotions', 'Promotions', 3),
  tab('social', 'Social', 0),
]

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

async function mount(active: InboxCategory) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({
    setup: () => () =>
      h(InboxTabs, {
        tabs: TABS,
        active,
        routeFor: (category: InboxCategory) => ({ query: { category } }),
      }),
  })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  await nextTick()
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const links = [...root.querySelectorAll<HTMLElement>('a[data-route]')].filter(
    (link) => link.dataset.route !== 'null',
  )
  return { root, links }
}

describe("the phone's Inbox categories", () => {
  it('lists every other category in Primary, each with its unread count, leading to it', async () => {
    const { links } = await mount('primary')
    const read = (link: HTMLElement) => [
      link.querySelector('span:not([aria-hidden])')?.textContent?.trim(),
      link.querySelector('b')?.textContent,
    ]
    expect(links.map(read)).toEqual([
      ['Updates', '99+'],
      ['Promotions', '3'],
      ['Social', undefined],
    ])
    expect(JSON.parse(links[0].dataset.route!)).toEqual({ query: { category: 'updates' } })
  })

  it('draws nothing in another category: the title names it and leads back', async () => {
    const { root } = await mount('updates')
    expect(root.querySelector('[data-testid="inbox-tabs"]')).toBeNull()
  })
})
