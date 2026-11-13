import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'

import SheetCommentsPanel from './SheetCommentsPanel.vue'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const toast = vi.hoisted(() => ({ error: vi.fn() }))
// Plain stand-ins: a Button is a <button> that a `loading` or `disabled`
// prop disables, as frappe-ui's does.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const passthrough = (tag: string) =>
    defineComponent({
      inheritAttrs: false,
      props: ['modelValue', 'label', 'loading', 'disabled', 'type'],
      emits: ['update:modelValue'],
      setup:
        (props, { attrs, emit, slots }) =>
        () =>
          tag === 'button'
            ? h(
                'button',
                { ...attrs, type: props.type, disabled: props.disabled || props.loading },
                props.label ?? slots.default?.(),
              )
            : h(tag, {
                ...attrs,
                value: props.modelValue,
                onInput: (e: Event) => {
                  if (e.target instanceof HTMLTextAreaElement)
                    emit('update:modelValue', e.target.value)
                },
              }),
    })
  return {
    toast,
    Button: passthrough('button'),
    Textarea: passthrough('textarea'),
    TextInput: passthrough('input'),
    Avatar: passthrough('span'),
    Skeleton: passthrough('div'),
  }
})
vi.mock('@/apps/drive', async () => {
  const { defineComponent, h, ref } = await import('vue')
  return {
    GUEST_NAME_LIMIT: 50,
    DriveCommentAuthor: defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h('span', slots.default?.()),
    }),
    useDriveGuestName: () => ({
      shown: ref(false),
      text: ref(''),
      atLimit: ref(false),
      maxLength: 50,
      take: () => undefined,
    }),
  }
})

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** The panel over a server whose `create` waits until `land()` is called. */
async function mountPanel() {
  const rows = ref<unknown[]>([])
  let land = () => {}
  const create = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        land = () => {
          rows.value = [
            {
              name: 't1',
              anchor: { sheet: 'Sheet1', cell: 'B2' },
              comments: [{ name: 'c1', content: 'Check this', author: 'a@x.com' }],
            },
          ]
          resolve()
        }
      }),
  )
  const session = fromPartial<DocumentSession>({
    comments: { list: async () => ({ threads: rows.value }), create },
  })
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(
    defineComponent({
      setup: () => () =>
        h(SheetCommentsPanel, {
          session,
          cursor: { sheet: 'Sheet1', cell: 'B2' },
          canComment: true,
        }),
    }),
  )
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  await settle()
  return { root, create, land: () => land() }
}

function type(root: HTMLElement, text: string) {
  const box = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="New comment"]')!
  box.value = text
  box.dispatchEvent(new Event('input'))
}

describe('SheetCommentsPanel', () => {
  // ISSUES #150: Insert > Comment and the toolbar's Comment button left focus
  // on the button, so typing went nowhere.
  it('puts the cursor in the new-comment box when it opens', async () => {
    const { root } = await mountPanel()
    expect(document.activeElement).toBe(root.querySelector('textarea[aria-label="New comment"]'))
  })
})
