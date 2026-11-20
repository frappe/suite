import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import RailItem from './RailItem.vue'

// Unit tests alias frappe-ui to a stub. The item is its icon, and the tooltip's second line.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    SidebarRailItem: defineComponent({
      props: { description: String },
      setup:
        (props, { slots }) =>
        () =>
          h('div', { 'data-description': props.description }, slots.default?.()),
    }),
  }
})

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

async function mount(props: InstanceType<typeof RailItem>['$props']) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  await router.push('/')
  const root = document.createElement('div')
  const app = createApp({ setup: () => () => h(RailItem, props) })
  app.config.globalProperties.__ = (text: string) => text
  app.use(router)
  app.mount(root)
  cleanup = () => app.unmount()
  const dot = root.querySelector<HTMLElement>('[data-icon-dot]')
  return {
    dot: dot ? (dot.className.includes('bg-surface-red-6') ? 'red' : 'gray') : null,
    tooltip: root.querySelector<HTMLElement>('[data-description]')?.dataset.description,
  }
}

const icon = { render: () => h('svg') }

describe('the rail unread dot', () => {
  it('is red for mail that is the reader’s own', async () => {
    expect((await mount({ label: 'Mail', icon, badge: 3, badgeStyle: 'dot' })).dot).toBe('red')
  })

  it('is gray for mail that is not theirs alone', async () => {
    const item = await mount({ label: 'Mail', icon, badge: 3, badgeStyle: 'dot', badgeQuiet: true })
    expect(item.dot).toBe('gray')
  })

  it('is not drawn with nothing to count', async () => {
    expect((await mount({ label: 'Mail', icon, badge: 0, badgeStyle: 'dot' })).dot).toBeNull()
  })

  it('says the count in the tooltip', async () => {
    const item = await mount({ label: 'Mail', icon, badge: 3, badgeStyle: 'dot' })
    expect(item.tooltip).toBe('3 unread')
  })

  it('names each place the count is in, one to a line', async () => {
    const item = await mount({
      label: 'Mail',
      icon,
      badge: 9,
      badgeStyle: 'dot',
      badgeParts: [
        { label: 'me@example.com', count: 5 },
        { label: 'team@example.com', count: 4 },
      ],
    })
    expect(item.tooltip).toBe('me@example.com · 5\nteam@example.com · 4')
  })
})
