import { nextTick } from 'vue'

export const confirmed = { asked: [] as string[], answer: true }

export interface ShownToast {
  message: string
  duration: number
  action: { label: string; onClick: () => void }
}

export const toasts: ShownToast[] = []
export const warnings: string[] = []
export const errors: string[] = []
export const me = { id: 'Asha Rao' }

export async function fakeSession() {
  const { computed: derive } = await import('vue')
  const { vi } = await import('vitest')
  const session = await vi.importActual<typeof import('@/platform/session')>('@/platform/session')
  const user = derive(() => ({ id: me.id, fullName: me.id, avatar: null }))
  return {
    ...session,
    useSession: () => ({ ...session.useSession(), user }),
    isAuthenticated: derive(() => true),
  }
}

export async function fakeUsers() {
  const { shallowRef } = await import('vue')
  const names: Record<string, string> = { 'ben@x.com': 'Ben Roy' }
  return {
    useUsers: () => ({ users: shallowRef([]), answeredQuery: shallowRef('') }),
    searchMentions: () => {},
    fullName: (user: string) => names[user] ?? user,
    lookUp: async () => {},
  }
}

export function fakeFeedback() {
  return {
    confirm: async ({ title }: { title: string }) => {
      confirmed.asked.push(title)
      return confirmed.answer
    },
    toast: {
      success: (message: string, options: Omit<ShownToast, 'message'>) =>
        toasts.push({ message, ...options }),
      warning: (message: string) => warnings.push(message),
      error: (message: string) => errors.push(message),
    },
  }
}

export async function fakeFrappeUi() {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  // A text box whose parent can focus it, like frappe-ui's own
  function box(tag: 'input' | 'textarea') {
    return define({
      props: { modelValue: String },
      emits: ['update:modelValue'],
      setup(props, { emit, expose }) {
        const field = state<HTMLInputElement | null>(null)
        expose({ focus: () => field.value?.focus() })
        function write(event: Event) {
          emit('update:modelValue', (event.target as HTMLInputElement).value)
        }

        return () => render(tag, { ref: field, value: props.modelValue, onInput: write })
      },
    })
  }

  return {
    Avatar: define({
      props: { image: String, label: String },
      setup: (props) => () =>
        render('span', { 'data-avatar': props.label, 'data-image': props.image ?? 'none' }),
    }),
    Button: define({
      props: { label: String, type: String },
      emits: ['click'],
      setup:
        (props, { emit }) =>
        () =>
          render(
            'button',
            { type: props.type ?? 'button', onClick: () => emit('click') },
            props.label,
          ),
    }),
    // Shows the menu's items beside its button, as if it were open; a pick reports closing a tick later
    Dropdown: define({
      props: { options: Array as () => { label: string; onClick: () => void }[] },
      emits: ['update:open'],
      setup:
        (props, { emit, slots }) =>
        () =>
          render('div', [
            render('div', { onClick: () => emit('update:open', true) }, slots.default?.()),
            props.options?.map((option) =>
              render(
                'button',
                {
                  role: 'menuitem',
                  onClick: async () => {
                    option.onClick()
                    await nextTick()
                    emit('update:open', false)
                  },
                },
                option.label,
              ),
            ),
          ]),
    }),
    Textarea: box('textarea'),
    TextInput: box('input'),
  }
}

export async function fakeDrive() {
  const { defineComponent: define, h: render, ref: state } = await import('vue')
  return {
    DriveCommentAuthor: define({
      setup:
        (_props, { slots }) =>
        () =>
          render('span', slots.default?.()),
    }),
    GUEST_NAME_LIMIT: 140,
    useDriveGuestName: () => ({
      shown: state(false),
      text: state(''),
      atLimit: state(false),
      maxLength: 140,
      take: () => undefined,
    }),
  }
}
