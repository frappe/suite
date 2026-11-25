import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type PropType, type SetupContext } from 'vue'

import ScreenedEmailAddressSettings from './ScreenedEmailAddressSettings.vue'

// The screened senders on a phone's page, where a tap on a sender acts on that sender alone.
const state = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'personal',
    userResource: { data: { accounts: [{ id: 'personal', enable_screening: 1 }] } },
    screenedAddresses: {
      data: [
        { email: 'lena@example.com', action: 'Accepted', modified: '', creation: '' },
        { email: 'marco@example.com', action: 'Accepted', modified: '', creation: '' },
      ],
    },
  }),
}))
vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn(), getFormattedDate: () => '' }))
vi.mock('@/apps/mail/utils/datetime', () => ({ formatSystemDateTime: () => '' }))
vi.mock('@/apps/mail/components/Modals/AddScreenedSenderModal.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  const { fakeMutation } = await import('@/platform/testing/mutations')
  return {
    api: { mail: api },
    useMutation: (reference: { id: string }) =>
      fakeMutation((input) => state.save(reference.id, input), vi.fn()),
  }
})
// The row shows its part in place, as a phone's page does
vi.mock('@/platform/settings/SettingsDialogRow.vue', () => ({
  default: {
    setup:
      (_: unknown, { slots }: SetupContext) =>
      () =>
        h('div', slots.default?.()),
  },
}))
vi.mock('@/platform/settings/SettingsEmptyList.vue', () => ({ default: { render: () => null } }))
// A sheet's or a dialog's choices, as buttons while it is open
interface Choice {
  label: string
  onClick?: () => void
}
const choices = await vi.hoisted(async () => {
  const { defineComponent, h } = await import('vue')
  return defineComponent({
    props: {
      open: Boolean,
      options: { type: Array as PropType<(Choice | { options: Choice[] })[]>, default: () => [] },
      actions: { type: Array as PropType<Choice[]>, default: () => [] },
    },
    setup:
      (props, { slots }) =>
      () =>
        h('div', [
          slots.default?.(),
          ...(props.open
            ? [
                ...props.options.flatMap((o) => ('options' in o ? o.options : [o])),
                ...props.actions,
              ]
            : []
          ).map((choice) => h('button', { onClick: () => choice.onClick?.() }, choice.label)),
        ]),
  })
})
vi.mock('@/platform/feedback/AdaptiveDropdown.vue', () => ({ default: choices }))
vi.mock('@/platform/feedback/AdaptiveDialog.vue', () => ({ default: choices }))
vi.mock('frappe-ui', () => ({
  Button: { render: () => null },
  FormControl: { render: () => null },
  Select: { render: () => null },
  SettingsRow: { render: () => null },
  Switch: { render: () => null },
}))

let app: ReturnType<typeof createApp> | undefined
afterEach(() => app?.unmount())

it('removes only the sender tapped on a phone, once the removal is confirmed', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  app = createApp(ScreenedEmailAddressSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.provide('app-settings-mobile-page', true)
  app.mount(root)
  const press = async (text: string) => {
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
    button?.click()
    await nextTick()
  }

  await press('lena@example.com')
  await press('Remove')
  await press('Remove senders')

  expect(state.save).toHaveBeenCalledWith(expect.anything(), {
    account: 'personal',
    emails: ['lena@example.com'],
  })
})
