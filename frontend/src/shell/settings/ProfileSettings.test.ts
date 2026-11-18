import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import { translationPlugin } from '@/platform/translation'

import ProfileSettings from './ProfileSettings.vue'

vi.mock('frappe-ui', async (original) => {
  const { defineComponent, h } = await import('vue')
  const slot = defineComponent(
    (_, { slots }) =>
      () =>
        h('div', [slots.default?.(), slots.actions?.()]),
  )
  // A picked photo uploads at once: the button stands in for choosing a file.
  const FileUploader = defineComponent({
    emits: ['success'],
    setup:
      (_, { slots, emit }) =>
      () =>
        h('div', [
          slots.default?.({ openFileSelector: () => {}, uploading: false, error: null }),
          h('button', {
            'data-test': 'upload',
            onClick: () => emit('success', { file_url: '/files/maya.png' }),
          }),
        ]),
  })
  const FormControl = defineComponent(
    (props: { modelValue?: string; label?: string }, { emit }) =>
      () =>
        h('input', {
          'data-label': props.label,
          value: props.modelValue,
          onInput: (event: Event) => {
            if (event.target instanceof HTMLInputElement)
              emit('update:modelValue', event.target.value)
          },
        }),
    { props: ['modelValue', 'label'], emits: ['update:modelValue'] },
  )
  return {
    ...(await original<object>()),
    SettingsHeader: slot,
    SettingsBody: slot,
    FileUploader,
    FormControl,
  }
})

// The profile as the server has it. Saving it reloads it, as the preferences read does after a save.
// SAFETY: null is the state before the test fills it with a profile of this shape.
const profile = vi.hoisted(() => ({
  data: null as Record<string, string | null> | null,
}))
vi.mock('@/api', async () => {
  const { reactive } = await import('vue')
  const user = reactive(profile)
  return {
    api: { suite: { preferences: { get: {}, update: {} } } },
    useQuery: () => user,
    useMutation: () => ({
      isPending: false,
      run: async (changes: Record<string, string | null>) => {
        user.data = { ...user.data, ...changes }
      },
    }),
  }
})
vi.mock('@/platform/session', () => ({ useSession: () => ({ refresh: async () => {} }) }))
vi.mock('@/platform/feedback', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Dropdown: defineComponent(
      (_, { slots }) =>
        () =>
          h('div', slots.default?.()),
    ),
    toast: { success: () => {}, error: () => {} },
  }
})

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(ProfileSettings)
  app.use(translationPlugin)
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  return root
}

it('keeps a name being edited when the photo saves', async () => {
  profile.data = { first_name: 'Maya', last_name: 'Lin', email: 'maya@x.test', user_image: null }
  const root = mount()
  const firstName = () => root.querySelector<HTMLInputElement>('input[data-label="First name"]')
  await vi.waitFor(() => expect(firstName()).not.toBeNull())
  firstName()!.value = 'Mayaa'
  firstName()!.dispatchEvent(new Event('input'))
  await nextTick()

  root.querySelector<HTMLButtonElement>('button[data-test="upload"]')!.click()
  await vi.waitFor(() => expect(profile.data?.user_image).toBe('/files/maya.png'))
  await nextTick()

  expect(firstName()!.value).toBe('Mayaa')
})
