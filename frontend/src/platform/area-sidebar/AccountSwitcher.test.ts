import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import AccountSwitcher from './AccountSwitcher.vue'

// Unit tests alias frappe-ui to a stub. The button is its label and what it leads with.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const wrap = (attrs: Record<string, string> = {}) =>
    defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          h('div', attrs, slots.default?.()),
    })
  return {
    Avatar: defineComponent({
      props: { label: String },
      setup: (props) => () => h('i', { 'data-avatar': props.label }),
    }),
    Dropdown: wrap({ 'data-menu': '' }),
    SidebarSection: wrap(),
    SidebarItem: defineComponent({
      props: { label: String },
      setup:
        (props, { slots }) =>
        () =>
          h('div', { 'data-button': props.label }, slots.prefix?.()),
    }),
  }
})

const accounts = [
  { id: 'one', _name: 'one@example.com' },
  { id: 'two', _name: 'two@example.com' },
]

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function mount(props: InstanceType<typeof AccountSwitcher>['$props']) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ setup: () => () => h(AccountSwitcher, props) })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const button = () => root.querySelector<HTMLElement>('[data-button]')!
  return {
    root,
    label: () => button().dataset.button,
    // The account whose avatar the button shows; none while it shows the every-account mark.
    avatar: () => button().querySelector<HTMLElement>('[data-avatar]')?.dataset.avatar,
  }
}

describe('AccountSwitcher', () => {
  // Calendar names the reader's own account by the reader, not by its address. The avatar stays
  // the account's, so it is the one its row in the menu shows.
  it("shows the account's avatar whatever the app calls the account", () => {
    const view = mount({ accounts, activeId: 'one', label: 'Reader Name' })
    expect(view.label()).toBe('Reader Name')
    expect(view.avatar()).toBe('one@example.com')
  })

  it('shows no single account while every account is showing', () => {
    const all = { label: 'All accounts', active: true, onSelect: () => {} }
    const view = mount({ accounts, activeId: 'one', label: 'All accounts', all })
    expect(view.avatar()).toBeUndefined()
  })

  it('offers no menu with nothing to pick', () => {
    const one = mount({ accounts: accounts.slice(0, 1), activeId: 'one', label: 'one@example.com' })
    expect(one.root.querySelector('[data-menu]')).toBeNull()
    const fixed = mount({ accounts, activeId: 'one', label: 'one@example.com', fixed: true })
    expect(fixed.root.querySelector('[data-menu]')).toBeNull()
  })

  // jsdom lays nothing out, so it can't hit-test a tap. What it can see is that the row asks for
  // the hit area that grows only where no other row is (touch-target-row, in index.css), inside
  // a section isolated so that area can take taps.
  it('takes the touch hit area that yields to the rows below it', () => {
    const view = mount({ accounts, activeId: 'one', label: 'one@example.com' })
    const button = view.root.querySelector<HTMLElement>('[data-button]')!
    expect(button.classList).toContain('touch-target-row')
    expect(button.closest('.isolate')).not.toBeNull()
  })
})
