import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import NewMeetDialog from './NewMeetDialog.vue'

const state = vi.hoisted(() => ({
  query: vi.fn(),
  create: vi.fn(),
  push: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: state.push }) }))
vi.mock('../composables/useConnectionState', () => ({
  useConnectionState: () => ({ justCreated: false }),
}))
vi.mock('@/api', () => ({
  api: {
    meet: {
      rooms: { create: 'create', linkAvailability: 'linkAvailability' },
    },
  },
  client: { query: state.query },
  useMutation: () => ({ run: state.create }),
}))
vi.mock('frappe-ui', () => ({
  Dialog: defineComponent({
    props: ['open', 'title'],
    setup:
      (props, { slots }) =>
      () =>
        props.open ? h('section', [props.title, slots.default?.(), slots.actions?.()]) : null,
  }),
  Button: defineComponent({
    props: ['label', 'disabled'],
    setup:
      (props, { attrs }) =>
      () =>
        h('button', { ...attrs, disabled: props.disabled }, props.label),
  }),
  Switch: defineComponent({
    props: ['label', 'modelValue'],
    emits: ['update:modelValue'],
    setup:
      (props, { emit }) =>
      () =>
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            onClick: () => emit('update:modelValue', !props.modelValue),
          },
          props.label,
        ),
  }),
  TextInput: defineComponent({
    props: ['modelValue', 'size'],
    emits: ['update:modelValue'],
    setup:
      (props, { attrs, emit }) =>
      () =>
        h('input', {
          ...attrs,
          value: props.modelValue,
          onInput: (event: Event) => {
            if (event.target instanceof HTMLInputElement)
              emit('update:modelValue', event.target.value)
          },
        }),
  }),
}))

let cleanup: (() => void) | undefined

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  state.query.mockResolvedValue({ status: 'available' })
  state.create.mockResolvedValue({
    code: 'abcd-efgh-ijkl',
  })
})

afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
})

function mount() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const open = ref(true)
  const app = createApp({
    setup: () => () =>
      h(NewMeetDialog, {
        open: open.value,
        'onUpdate:open': (value: boolean) => {
          open.value = value
        },
      }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }

  const input = (label: string) =>
    root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  const button = (label: string) =>
    Array.from(root.querySelectorAll('button')).find((item) => item.textContent === label)!
  const enter = async (label: string, value: string) => {
    const field = input(label)!
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  return { root, input, button, enter }
}

describe('New meet', () => {
  it('shows the link only when enabled and stops following the title after a link edit', async () => {
    const { input, button, enter } = mount()
    expect(input('Custom link')).toBeNull()
    expect(state.query).not.toHaveBeenCalled()
    await enter('Meet title', 'Sales & Support')
    button('Custom link').click()
    await nextTick()

    expect(input('Custom link')?.value).toBe('sales-support')
    await enter('Custom link', 'sales-desk')
    await enter('Meet title', 'Support')
    expect(input('Custom link')?.value).toBe('sales-desk')

    button('Custom link').click()
    await nextTick()
    expect(input('Custom link')).toBeNull()
  })

  it('starts a restricted meet at its custom address and closes the dialog', async () => {
    const { root, button, enter } = mount()
    await enter('Meet title', 'Sales team')
    button('Restricted').click()
    button('Custom link').click()
    await vi.advanceTimersByTimeAsync(300)

    expect(button('Copy link')).toBeUndefined()
    expect(state.create).not.toHaveBeenCalled()
    button('Start').click()
    await nextTick()
    await nextTick()

    expect(state.create).toHaveBeenCalledWith({
      type: 'restricted',
      title: 'Sales team',
      link: 'sales-team',
    })
    expect(state.push).toHaveBeenCalledWith({
      name: 'meet-meeting',
      params: { meetingId: 'sales-team' },
    })
    expect(root.querySelector('section')).toBeNull()
  })

  it('blocks Start for an invalid or already taken link', async () => {
    state.query.mockResolvedValue({ status: 'taken' })
    const { root, button, enter } = mount()
    button('Custom link').click()
    await nextTick()
    await enter('Custom link', 'a!')
    expect(root.textContent).toContain('Use 3–40 lowercase letters, numbers or hyphens')
    expect(button('Start').disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(state.query).not.toHaveBeenCalled()

    await enter('Custom link', 'sales-team')
    expect(button('Start').disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(root.textContent).toContain('Already taken')
    button('Start').click()
    expect(state.create).not.toHaveBeenCalled()
  })
})
