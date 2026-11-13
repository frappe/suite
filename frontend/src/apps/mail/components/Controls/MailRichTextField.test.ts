import type { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import MailRichTextField from './MailRichTextField.vue'

vi.mock('frappe-ui', () => ({
  useFileUpload: () => ({ upload: vi.fn() }),
  toast: { error: vi.fn() },
}))
vi.mock('@/apps/mail/utils/composables', async () => {
  const { ref } = await import('vue')
  return { useScreenSize: () => ({ isMobile: ref(false) }) }
})
vi.mock('@/apps/mail/components/Controls/EditorHeadingMenu.vue', () => ({
  default: defineComponent({ render: () => h('span') }),
}))

let unmount = () => {}
afterEach(() => unmount())

const mountField = async (initial: string, props: Record<string, unknown> = {}) => {
  const model = ref(initial)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    render: () =>
      h(MailRichTextField, {
        ...props,
        modelValue: model.value,
        'onUpdate:modelValue': (value?: string) => (model.value = value ?? ''),
      }),
  })
  app.mount(host)
  unmount = () => {
    app.unmount()
    host.remove()
  }
  await nextTick()
  const editorRoot = () => host.querySelector<HTMLElement>('.ProseMirror')!
  return { host, model, editorRoot }
}

// SAFETY: tiptap publishes its editor on the element its view mounts on, which is this one.
const editorOf = (element: HTMLElement) => (element as HTMLElement & { editor: Editor }).editor

describe('MailRichTextField', () => {
  it('shows what the server sends after it has mounted', async () => {
    const { model, editorRoot } = await mountField('')
    model.value = '<div>Regards</div>'
    await nextTick()
    expect(editorRoot().textContent).toBe('Regards')
  })

  it('hands back what was typed', async () => {
    const { model, editorRoot } = await mountField('<div>Regards</div>')
    editorOf(editorRoot()).commands.insertContent('<div>Asha</div>')
    expect(model.value).toContain('Asha')
  })

  it('does not rewrite a value it only loaded', async () => {
    const stored = '<div>Regards</div><div><br></div>'
    const { model } = await mountField('')
    model.value = stored
    await nextTick()
    expect(model.value).toBe(stored)
  })

  it('offers formatting while editable', async () => {
    const { host } = await mountField('')
    expect(host.querySelector('[data-slot="fixed-menu"]')).not.toBeNull()
  })

  it('is a plain preview when not editable', async () => {
    const { host, editorRoot } = await mountField('<div>Regards</div>', { editable: false })
    expect(host.querySelector('[data-slot="fixed-menu"]')).toBeNull()
    expect(editorRoot().getAttribute('contenteditable')).toBe('false')
  })
})
