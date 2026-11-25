import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type VNode } from 'vue'

import ProfileSettings from './ProfileSettings.vue'

// The name, saved as each field is left: a phone moves from one field to the next while the first
// one saves.
const state = vi.hoisted(() => ({
  user: { data: { first_name: 'Maya', last_name: 'Kim', email: 'maya@example.com' } },
  // SAFETY: an empty array, typed for the saves the mock pushes later.
  saves: [] as { input: Record<string, string>; done: () => void }[],
}))
vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))
vi.mock('@/platform/session', () => ({
  useSession: () => ({ user: { value: { id: 'maya@example.com' } }, refresh: async () => {} }),
}))
vi.mock('@/api', async () => {
  const { reactive } = await import('vue')
  const user = reactive(state.user)
  return {
    api: { suite: { preferences: { get: {}, update: {} }, account: { changePassword: {} } } },
    useQuery: () => user,
    useMutation: () => reactive({ isPending: false, error: null, run: async () => {} }),
    client: {
      // Held until the test lets it through; then the server has the name, and so does the page.
      mutation: (_: unknown, input: Record<string, string>) =>
        new Promise<void>((resolve) =>
          state.saves.push({
            input,
            done: () => {
              user.data = { ...user.data, ...input }
              resolve()
            },
          }),
        ),
    },
  }
})
vi.mock('@/shell/settings/SettingsTabHeader.vue', () => ({ default: { render: () => null } }))
vi.mock('@/shell/settings/SettingsTabContent.vue', () => ({
  default: {
    setup:
      (_: unknown, { slots }: { slots: { default?: () => VNode[] } }) =>
      () =>
        h('div', slots.default?.()),
  },
}))
vi.mock('frappe-ui', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Avatar: { render: () => null },
  Button: { render: () => null },
  Dialog: { render: () => null },
  Dropdown: { render: () => null },
  ErrorMessage: { render: () => null },
  FileUploader: { render: () => null },
  SettingsRow: { render: () => null },
  FormControl: defineComponent({
    props: { modelValue: { type: String, default: '' }, label: { type: String, default: '' } },
    emits: ['update:modelValue', 'blur'],
    setup:
      (props, { emit }) =>
      () =>
        h('input', {
          'aria-label': props.label,
          value: props.modelValue,
          // SAFETY: the listener is on an <input>, so its target is one.
          onInput: (event: Event) =>
            emit('update:modelValue', (event.target as HTMLInputElement).value),
          onBlur: () => emit('blur'),
        }),
  }),
}))

let app: ReturnType<typeof createApp> | undefined
afterEach(() => app?.unmount())

it('keeps what is typed in the next field while the last one saves, and saves it after', async () => {
  const root = document.body.appendChild(document.createElement('div'))
  app = createApp(ProfileSettings)
  app.mount(root)
  await nextTick()
  const field = (label: string) =>
    root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  const type = async (label: string, text: string) => {
    field(label).value = text
    field(label).dispatchEvent(new Event('input'))
    await nextTick()
  }

  await type('First name', 'Mia')
  field('First name').dispatchEvent(new Event('blur'))
  await type('Last name', 'Park')
  field('Last name').dispatchEvent(new Event('blur'))
  state.saves[0]!.done()
  await vi.waitFor(() => expect(state.saves).toHaveLength(2))

  expect(field('Last name').value).toBe('Park')
  expect(state.saves[1]!.input).toEqual({ first_name: 'Mia', last_name: 'Park' })
})
