import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type Component, type PropType } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import PhoneSearchBar from '@/apps/mail/components/mobile/PhoneSearchBar.vue'
import PhoneSearchRecents from '@/apps/mail/components/mobile/PhoneSearchRecents.vue'
import dayjs from '@/apps/mail/utils/dayjs'
import { translationPlugin } from '@/platform/translation'

// A phone's search screen, on a router of its own: the route is the search the list below runs.
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'a',
    mailboxIds: { inbox: 'm-inbox' },
    mailboxes: {
      data: [
        { id: 'm-inbox', _name: 'Inbox' },
        { id: 'm-archive', _name: 'Archive' },
      ],
    },
  }),
}))
vi.mock('@/utils/session', () => ({ getSessionUser: () => 'ada@suite.test' }))
// The sheets and menus are frappe-ui's and the platform's; here each option is a button.
vi.mock('@/platform/feedback/AdaptiveDropdown.vue', async () => {
  const { defineComponent, h } = await import('vue')
  type Option = { label: string; onClick: () => void }
  return {
    default: defineComponent({
      // SAFETY: the search bar hands its menus only labelled choices with a click handler.
      props: { options: { type: Array as PropType<Option[]>, required: true } },
      setup:
        (props, { slots }) =>
        () =>
          h('div', [
            slots.default?.(),
            ...props.options.map((option) =>
              h('button', { 'data-option': option.label, onClick: option.onClick }, option.label),
            ),
          ]),
    }),
  }
})
// The people sheet, open: someone picked from it, as a tap on a suggestion picks them.
vi.mock('@/apps/mail/components/mobile/SearchPersonSheet.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: { open: Boolean },
      emits: ['pick'],
      setup:
        (props, { emit }) =>
        () =>
          props.open
            ? h('button', { onClick: () => emit('pick', 'dana@example.com') }, 'Dana')
            : null,
    }),
  }
})

let cleanup: (() => void) | undefined
beforeEach(() => localStorage.clear())
afterEach(() => cleanup?.())

async function mountSearch(path: string, component: Component = PhoneSearchBar) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/mail/account/:accountId/mailbox/:mailbox',
        name: 'mail-mailbox',
        component: { render: () => null },
      },
    ],
  })
  await router.push(path)
  const root = document.body.appendChild(document.createElement('div'))
  const app = createApp({ setup: () => () => h(component) })
  app.use(router).use(translationPlugin)
  app.mount(root)
  await router.isReady()
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const query = () => router.currentRoute.value.query
  // frappe-ui's Button says its label; the stub here carries it as an attribute.
  const buttons = (label: string) =>
    [...document.querySelectorAll('button')].filter(
      (b) => (b.getAttribute('label') ?? b.textContent?.trim()) === label,
    )
  const button = (label: string) => buttons(label)[0]!
  const field = () => document.querySelector<HTMLInputElement>('input[type="search"]')!
  return { query, button, buttons, field }
}

const type = async (field: HTMLInputElement, text: string) => {
  field.value = text
  field.dispatchEvent(new Event('input'))
  await nextTick()
}

describe("a phone's search screen", () => {
  it('runs what is typed, without a key pressed', async () => {
    const { field, query } = await mountSearch('/mail/account/a/mailbox/search')
    await type(field(), 'invoice')

    await vi.waitFor(() => expect(query()).toEqual({ text: 'invoice' }))
  })

  it('searches mail to someone from the To chip, and the chip names them', async () => {
    const { button, buttons, query } = await mountSearch(
      '/mail/account/a/mailbox/search?text=invoice',
    )

    button('To').click()
    await nextTick()
    button('Dana').click()

    await vi.waitFor(() => expect(query()).toEqual({ text: 'invoice', to: 'dana@example.com' }))
    await vi.waitFor(() => expect(buttons('To dana@example.com')).toHaveLength(1))
  })

  it('narrows the search to unread mail and back with one chip', async () => {
    const { button, query } = await mountSearch('/mail/account/a/mailbox/search?text=invoice')

    button('Unread').click()
    await vi.waitFor(() => expect(query()).toEqual({ text: 'invoice', isRead: 'false' }))
    button('Unread').click()
    await vi.waitFor(() => expect(query()).toEqual({ text: 'invoice' }))
  })

  it('searches mail older than a week from the Date chip, and names the chip after it', async () => {
    const { button, buttons, query } = await mountSearch(
      '/mail/account/a/mailbox/search?text=invoice',
    )

    button('Older than a week').click()

    const weekAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')
    await vi.waitFor(() => expect(query()).toEqual({ text: 'invoice', before: weekAgo }))
    // The chip, and the option it was picked from.
    await vi.waitFor(() => expect(buttons('Older than a week')).toHaveLength(2))
  })

  it('offers a search run from the keyboard again, filters and all, until it is forgotten', async () => {
    const searched = await mountSearch(
      '/mail/account/a/mailbox/search?text=invoice&inMailbox=m-archive&isRead=false',
    )
    searched.field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await nextTick()
    cleanup?.()

    const { button, query } = await mountSearch(
      '/mail/account/a/mailbox/search',
      PhoneSearchRecents,
    )
    const recent = button('invoice · in:Archive · is:unread')
    recent.click()
    await vi.waitFor(() =>
      expect(query()).toEqual({ text: 'invoice', inMailbox: 'm-archive', isRead: 'false' }),
    )

    document.querySelector<HTMLElement>('[aria-label="Forget this search"]')!.click()
    await nextTick()
    expect(button('invoice · in:Archive · is:unread')).toBeUndefined()
  })

  it("leaves out another account's folder when a recent search is run again", async () => {
    localStorage.setItem(
      'mail-recent-searches:ada@suite.test',
      JSON.stringify([
        {
          resultType: 'mail-recent-search',
          text: 'invoice',
          filters: { inMailbox: 'b-archive', from: 'dana@example.com' },
          label: 'invoice · in:Archive · from:dana@example.com',
          account: 'b',
          at: 1,
        },
      ]),
    )
    const { button, query } = await mountSearch(
      '/mail/account/a/mailbox/search',
      PhoneSearchRecents,
    )

    button('invoice · in:Archive · from:dana@example.com').click()

    await vi.waitFor(() => expect(query()).toEqual({ text: 'invoice', from: 'dana@example.com' }))
  })
})
