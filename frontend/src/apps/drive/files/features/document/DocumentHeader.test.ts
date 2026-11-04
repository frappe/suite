import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type VNode } from 'vue'

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
  props: {
    saveState?: DocumentSaveState
    viewOnly?: boolean
    layout?: 'default' | 'centered' | 'compact'
  } = {},
  slots: Record<string, () => VNode> = {},
) {
  const panel = ref<DocumentPanel | null>(null)
  const header = ref<{ focusPanelToggle(name: DocumentPanel): void } | null>(null)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () =>
      h(
        DocumentHeader,
        {
          ref: header,
          session: doc as unknown as DocumentSession,
          titleLabel: 'Spreadsheet title',
          panels: ['comments', 'versions'],
          panel: panel.value,
          'onUpdate:panel': (next: DocumentPanel | null) => {
            panel.value = next
          },
          ...props,
        },
        slots,
      ),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const title = root.querySelector<HTMLInputElement>('input[aria-label="Spreadsheet title"]')!
  const button = (name: string) =>
    root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
  return { root, title, button, panel, header }
}

/** The group that holds the title field. */
function titleGroup(root: HTMLElement) {
  return root.querySelector('header > div:has(input[aria-label="Spreadsheet title"])')!
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

  it('hands focus to the toggle of a panel that closed itself', async () => {
    const { button, panel, header } = mount(session(40))
    button('Versions')!.click()
    await nextTick()
    panel.value = null
    await nextTick()

    header.value!.focusPanelToggle('versions')

    expect(document.activeElement).toBe(button('Versions'))
  })

  it('keeps the title beside the icon unless asked to center it', () => {
    const { root } = mount(session(40))
    expect(titleGroup(root).className).toBe('flex min-w-0 flex-1 items-center gap-1')
    expect(root.querySelector('[class*="md:"][class*="flex-1"]')).toBeNull()
    cleanup?.()

    const centered = mount(session(40), { layout: 'centered' }).root
    expect(titleGroup(centered).classList).toContain('md:contents')
    expect(titleGroup(centered).firstElementChild!.classList).toContain('md:flex-1')
    expect(centered.querySelector('header > div:last-child')!.classList).toContain('md:flex-1')
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

  it.each([
    ['solid, with its label', {}, true],
    [
      'an icon on every width, after a primary action',
      { primary: () => h('button', 'Present') },
      false,
    ],
  ])('shows Share %s', (_label, slots, isSolid) => {
    const sharer = session(40)
    const { root, button } = mount(sharer, {}, slots)
    const solid = [...root.querySelectorAll('button')].find(
      (el) => el.textContent === 'Share' && el.getAttribute('variant') === 'solid',
    )

    expect(!!solid).toBe(isSolid)
    expect(button('Share')!.classList.contains('md:hidden')).toBe(isSolid)
    solid?.click()
    button('Share')!.click()
    expect(sharer.share).toHaveBeenCalledTimes(isSolid ? 2 : 1)
  })

  it('puts the primary action last', () => {
    const { root } = mount(session(40), {}, { primary: () => h('button', 'Present') })

    expect(root.querySelector('header > div:last-child > :last-child')!.textContent).toBe('Present')
  })
})

describe('DocumentHeader, compact (Sheets)', () => {
  function mountWithMenus(compact: boolean) {
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp({
      setup: () => () =>
        h(
          DocumentHeader,
          {
            session: session(40) as unknown as DocumentSession,
            titleLabel: 'Spreadsheet title',
            saveState: 'clean',
            panels: ['comments', 'versions'],
            layout: compact ? 'compact' : 'default',
          },
          { menus: () => h('nav', { 'aria-label': 'Spreadsheet menus' }, 'File Edit') },
        ),
    })
    app.mount(root)
    cleanup = () => {
      app.unmount()
      root.remove()
    }
    const header = root.querySelector('header')!
    const saved = [...header.querySelectorAll('span')].find(
      (el) => el.textContent?.trim() === 'Saved',
    )!
    return { header, saved, menus: header.querySelector('nav')! }
  }

  it('puts Saved beside the title, then the menus', () => {
    const { header, saved, menus } = mountWithMenus(true)
    const left = header.firstElementChild!
    expect(left.contains(saved)).toBe(true)
    expect(saved.compareDocumentPosition(menus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(left.contains(menus)).toBe(true)
  })

  it('stays as it was for every other app', () => {
    const { header, saved } = mountWithMenus(false)
    // The save status sits on the right, before the panel toggles.
    expect(header.firstElementChild!.contains(saved)).toBe(false)
    expect(header.lastElementChild!.contains(saved)).toBe(true)
  })
})
