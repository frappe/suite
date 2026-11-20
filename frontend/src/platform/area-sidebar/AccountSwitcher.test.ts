import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, type FunctionalComponent } from 'vue'

import AccountSwitcher from './AccountSwitcher.vue'

// Unit tests alias frappe-ui to a stub. A row is its label and what it leads with; the menu is its
// rows, each a button.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  interface Row {
    label: string
    onClick: () => void
  }
  const Dropdown: FunctionalComponent<{ options: Row[] }> = (props, { slots }) =>
    h('div', { 'data-menu': '' }, [
      slots.default?.(),
      ...props.options.map((row) => h('button', { 'data-row': row.label, onClick: row.onClick })),
    ])
  Dropdown.props = ['options']
  return {
    Avatar: defineComponent({
      props: { label: String },
      setup: (props) => () => h('i', { 'data-avatar': props.label }),
    }),
    Dropdown,
    SidebarSection: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          h('div', slots.default?.()),
    }),
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
    rows: () => [...root.querySelectorAll<HTMLElement>('[data-row]')].map((row) => row.dataset.row),
  }
}

describe('AccountSwitcher', () => {
  it('shows the account in use, and offers the others', () => {
    const view = mount({ accounts, activeId: 'two', label: 'two@example.com' })
    expect(view.label()).toBe('two@example.com')
    expect(view.avatar()).toBe('two@example.com')
    expect(view.rows()).toEqual(['one@example.com', 'two@example.com'])
  })

  // Calendar names the reader's own account by the reader, not by its address. The avatar stays
  // the account's, so it is the one its row in the menu shows.
  it("shows the account's avatar whatever the app calls the account", () => {
    const view = mount({ accounts, activeId: 'one', label: 'Reader Name' })
    expect(view.label()).toBe('Reader Name')
    expect(view.avatar()).toBe('one@example.com')
  })

  it('only names the account when there is no other to pick', () => {
    const view = mount({
      accounts: accounts.slice(0, 1),
      activeId: 'one',
      label: 'one@example.com',
    })
    expect(view.label()).toBe('one@example.com')
    expect(view.root.querySelector('[data-menu]')).toBeNull()
  })

  it('only names the account when it is fixed', () => {
    const view = mount({ accounts, activeId: 'one', label: 'one@example.com', fixed: true })
    expect(view.avatar()).toBe('one@example.com')
    expect(view.root.querySelector('[data-menu]')).toBeNull()
  })

  it('shows no single account while every account is showing', () => {
    const all = { label: 'All accounts', active: true, onSelect: () => {} }
    const view = mount({ accounts, activeId: 'one', label: 'All accounts', all })
    expect(view.label()).toBe('All accounts')
    expect(view.avatar()).toBeUndefined()
  })

  // jsdom lays nothing out, so it can't hit-test a tap. What it can see is that the row asks for
  // the hit area that grows only where no other row is (touch-target-row, in index.css), inside
  // a section isolated so that area can take taps.
  it('takes the touch hit area that yields to the rows below it', () => {
    const view = mount({
      accounts: accounts.slice(0, 1),
      activeId: 'one',
      label: 'one@example.com',
    })
    const button = view.root.querySelector<HTMLElement>('[data-button]')!
    expect(button.classList).toContain('touch-target-row')
    expect(button.parentElement!.classList).toContain('isolate')
  })

  it('hands a picked account to the app', () => {
    const onSelect = vi.fn()
    const view = mount({ accounts, activeId: 'one', label: 'one@example.com', onSelect })
    view.root.querySelector<HTMLElement>('[data-row="two@example.com"]')!.click()
    expect(onSelect).toHaveBeenCalledWith('two')
  })
})
