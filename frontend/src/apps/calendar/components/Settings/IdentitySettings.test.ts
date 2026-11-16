import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, reactive } from 'vue'

import IdentitySettings from '@/apps/calendar/components/Settings/IdentitySettings.vue'
import { translationPlugin } from '@/platform/translation'

// Unit tests alias frappe-ui to a stub without the settings layout pieces;
// these render their content and labels, which is all the test reads.
vi.mock('frappe-ui', async (original) => {
  const { defineComponent, h } = await import('vue')
  const slot = defineComponent(
    (_, { slots }) =>
      () =>
        h('div', [slots.default?.(), slots.actions?.()]),
  )
  const labelled = defineComponent({
    props: { label: { type: String, default: '' } },
    setup: (props) => () => h('span', props.label),
  })
  return {
    ...(await original<object>()),
    SettingsHeader: slot,
    SettingsBody: slot,
    Badge: labelled,
  }
})
vi.mock('@/platform/feedback', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Dropdown: defineComponent(
      (_, { slots }) =>
        () =>
          h('div', slots.default?.()),
    ),
    toast: { success: () => {}, error: () => {} },
    confirm: async () => false,
  }
})

// SAFETY: undefined is the loading state; the tests set rows later.
const identities = vi.hoisted(() => ({ data: undefined as unknown[] | undefined }))
// The account's addresses, as its mail identities name them.
const mailIdentities = vi.hoisted(() => ({
  data: [{ email: 'maya@northwind.test' }, { email: 'events@northwind.test' }] as unknown[],
}))
vi.mock('@/apps/calendar/stores/user', async () => {
  const { reactive } = await import('vue')
  const participantIdentities = reactive(identities)
  const mail = reactive(mailIdentities)
  return {
    userStore: () => ({
      participantIdentities,
      identities: mail,
      accountId: 'maya@northwind.test',
    }),
  }
})

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(IdentitySettings)
  app.use(translationPlugin)
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  return root
}

describe('Calendar > Identity', () => {
  it('says there are no identities yet instead of showing a blank tab', async () => {
    identities.data = []
    const root = mount()
    await vi.waitFor(() => expect(root.textContent).toContain('No identities yet'))
  })

  it('lists each identity by name with its email, and marks the default', async () => {
    identities.data = reactive([
      {
        name: 'a|1',
        account: 'a',
        id: '1',
        _name: 'Maya Lin',
        email: 'maya@northwind.test',
        default: 1,
      },
      { name: 'a|2', account: 'a', id: '2', _name: '', email: 'events@northwind.test', default: 0 },
    ])
    const root = mount()
    await vi.waitFor(() => expect(root.textContent).toContain('Maya Lin'))
    expect(root.textContent).toContain('maya@northwind.test')
    expect(root.textContent).toContain('events@northwind.test')
    expect(root.textContent).toContain('Default')
    expect(root.textContent).not.toContain('No identities yet')
  })

  it('offers New only while one of the addresses has no identity', async () => {
    identities.data = reactive([
      {
        name: 'a|1',
        account: 'a',
        id: '1',
        _name: 'Maya',
        email: 'maya@northwind.test',
        default: 1,
      },
    ])
    const root = mount()
    const newButton = () => root.querySelector('button[label="New"]')
    await vi.waitFor(() => expect(newButton()).not.toBeNull())

    identities.data.push({
      name: 'a|2',
      account: 'a',
      id: '2',
      _name: '',
      email: 'events@northwind.test',
      default: 0,
    })
    await vi.waitFor(() => expect(newButton()).toBeNull())
  })
})
