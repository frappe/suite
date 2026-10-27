import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive/client/session'
import { TransportError } from '@/platform/transport'

import DocumentHeader from './DocumentHeader.vue'
import type { DocumentPanel, DocumentSaveState } from './header'

// Plain stand-ins: the test frappe-ui build has no TextInput or Badge.
vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render, ref: reference } = await import('vue')
  return {
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
    Button: define({
      inheritAttrs: false,
      props: { label: String },
      setup:
        (props, { attrs }) =>
        () =>
          render('button', attrs, props.label),
    }),
    Badge: define({
      props: { label: String },
      setup: (props) => () => render('span', props.label),
    }),
    TextInput: define({
      inheritAttrs: false,
      props: { modelValue: String, readonly: Boolean },
      emits: ['update:modelValue'],
      setup(props, { attrs, emit, expose }) {
        const inputElement = reference<HTMLInputElement | null>(null)
        expose({ inputElement })
        return () =>
          render('input', {
            ...attrs,
            ref: inputElement,
            value: props.modelValue,
            readOnly: props.readonly,
            onInput: (event: Event) =>
              emit('update:modelValue', (event.target as HTMLInputElement).value),
          })
      },
    }),
  }
})

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function session(role: number, canShare = true) {
  return {
    nodeId: 'node-1',
    contentDoctype: 'Sheet',
    contentDocname: 'sheet-1',
    title: ref('Budget'),
    state: ref('Active'),
    access: ref({ role }),
    canShare: ref(canShare),
    rename: vi.fn(async function (this: { title: { value: string } }, title: string) {
      this.title.value = title
    }),
    share: vi.fn(),
  }
}

function mount(
  doc: ReturnType<typeof session>,
  props: { saveState?: DocumentSaveState; viewOnly?: boolean } = {},
) {
  const panel = ref<DocumentPanel | null>(null)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () =>
      h(DocumentHeader, {
        session: doc as unknown as DocumentSession,
        titleLabel: 'Spreadsheet title',
        panels: ['comments', 'versions'],
        panel: panel.value,
        'onUpdate:panel': (next: DocumentPanel | null) => {
          panel.value = next
        },
        ...props,
      }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const title = root.querySelector<HTMLInputElement>('input[aria-label="Spreadsheet title"]')!
  const button = (name: string) =>
    root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
  return { root, title, button, panel }
}

describe('DocumentHeader', () => {
  it('shows the spreadsheet icon, the title and the save status', () => {
    const { root, title } = mount(session(40), { saveState: 'clean' })
    expect(root.querySelector('.file-icon-sheet.text-ink-green-6')).not.toBeNull()
    expect(title.value).toBe('Budget')
    expect(root.textContent).toContain('Saved')
  })

  it('renames on blur, and Escape puts the old title back', async () => {
    const doc = session(40)
    const { title } = mount(doc)

    title.value = '  Budget 2027 '
    title.dispatchEvent(new Event('input'))
    title.dispatchEvent(new FocusEvent('blur'))
    expect(doc.rename).toHaveBeenCalledWith('Budget 2027')

    title.value = 'Typo'
    title.dispatchEvent(new Event('input'))
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(title.value).toBe('Budget 2027')
    expect(doc.rename).toHaveBeenCalledOnce()
  })

  it('says a taken name in plain words and offers the free one', async () => {
    const doc = session(40)
    doc.rename.mockRejectedValueOnce(
      new TransportError({
        type: 'DriveConflict',
        status: 409,
        message: 'An active Drive node with this title already exists',
        free_title: 'Rates (2)',
      }),
    )
    const { root, title } = mount(doc)

    title.value = 'Rates'
    title.dispatchEvent(new Event('input'))
    title.dispatchEvent(new FocusEvent('blur'))
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).not.toBeNull())

    const alert = root.querySelector('[role="alert"]')!.textContent!.trim()
    expect(alert).toBe('That name is taken in this folder. Try “Rates (2)”.')
    expect(title.value).toBe('Budget')
  })

  it.each([
    ['another conflict', 409, 'DriveConflict', 'The Drive file bytes are unavailable'],
    ['a refusal written for people', 417, 'ValidationError', 'Keep the .pdf extension.'],
    ['no connection', 0, 'TransportError', 'Could not rename this file. Try again.'],
    ['a server failure', 500, 'InternalServerError', 'Could not rename this file. Try again.'],
  ])('shows %s as the refusal', async (_case, status, type, expected) => {
    const doc = session(40)
    const message = status === 0 ? 'Failed to fetch' : status === 500 ? 'Traceback …' : expected
    doc.rename.mockRejectedValueOnce(new TransportError({ type, status, message }))
    const { root, title } = mount(doc)

    title.value = 'Rates'
    title.dispatchEvent(new Event('input'))
    title.dispatchEvent(new FocusEvent('blur'))
    await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).not.toBeNull())

    expect(root.querySelector('[role="alert"]')!.textContent!.trim()).toBe(expected)
  })

  it('does not let a viewer rename, and says the document is view only', () => {
    const { root, title } = mount(session(10), { viewOnly: true })
    expect(title.readOnly).toBe(true)
    expect(root.textContent).toContain('View only')
  })

  it('toggles one side panel at a time', async () => {
    const { button, panel } = mount(session(40))
    button('Comments')!.click()
    await nextTick()
    expect(panel.value).toBe('comments')
    expect(button('Comments')!.getAttribute('aria-pressed')).toBe('true')

    button('Versions')!.click()
    await nextTick()
    expect(panel.value).toBe('versions')
    expect(button('Comments')!.getAttribute('aria-pressed')).toBe('false')

    button('Versions')!.click()
    await nextTick()
    expect(panel.value).toBeNull()
  })

  it('offers Share only to people who can share', () => {
    const sharer = session(40)
    const { root } = mount(sharer)
    const share = [...root.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('Share'),
    )
    share!.click()
    expect(sharer.share).toHaveBeenCalledOnce()
    cleanup?.()

    const { button } = mount(session(40, false))
    expect(button('Share')).toBeNull()
  })
})
