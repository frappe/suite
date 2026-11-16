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
        h('div', slots.default?.()),
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
vi.mock('@/apps/calendar/stores/user', async () => {
  const { reactive } = await import('vue')
  const participantIdentities = reactive(identities)
  return { userStore: () => ({ participantIdentities, accountId: 'maya@northwind.test' }) }
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
})
