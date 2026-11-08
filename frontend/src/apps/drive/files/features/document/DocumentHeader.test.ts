import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type VNode } from 'vue'

import type { DocumentSession } from '@/apps/drive/client/session'
import { TransportError } from '@/platform/transport'

import type { DocumentPanel } from '../../../client/types'
import DocumentHeader from './DocumentHeader.vue'
import type { DocumentSaveState } from './header'

// Plain stand-ins: the test frappe-ui build has no TextInput or Badge.
vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render, ref: reference } = await import('vue')
  return {
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
    Button: define({
      inheritAttrs: false,
      props: { label: String },
      setup:
        (props, { attrs, slots }) =>
        () =>
          render('button', attrs, props.label ?? slots.icon?.() ?? slots.default?.()),
    }),
    Tooltip: define({
      props: { disabled: Boolean },
      setup:
        (props, { slots }) =>
        () => [
          slots.default?.(),
          props.disabled ? null : render('div', { role: 'tooltip' }, slots.content?.()),
        ],
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
              emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).value),
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
    state: ref<DocumentSession['state']['value']>('Active'),
    access: ref({ role }),
    canShare: ref(canShare),
    editedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    createdAt: '2026-03-02T16:05:00Z',
    createdBy: 'Asha Rao',
    isStarred: ref(false),
    canStar: ref(true),
    setStarred: vi.fn(async function (this: { isStarred: { value: boolean } }, next: boolean) {
      this.isStarred.value = next
    }),
    rename: vi.fn(async function (this: { title: { value: string } }, title: string) {
      this.title.value = title
    }),
    share: vi.fn(),
  }
}

function mount(
  doc: ReturnType<typeof session>,
  props: {
    saveState?: DocumentSaveState | null
    saveNote?: string
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
          session: fromPartial<DocumentSession>(doc),
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
  it('shows a failed save as a badge', () => {
    const { root } = mount(session(40), { saveState: 'failed' })
    expect(root.textContent).toContain('Not saved')
    expect(root.textContent).not.toContain('Saved')
  })

  it('shows the spreadsheet icon, the title and when it was last edited', () => {
    const { root, title } = mount(session(40), { saveState: 'clean' })
    expect(root.querySelector('.file-icon-sheet.text-ink-green-6')).not.toBeNull()
    expect(title.value).toBe('Budget')
    expect(root.textContent).toContain('Edited 3h ago')
    expect(root.textContent).not.toContain('Saved')
  })

  it('says just now once this tab edits the document', async () => {
    const saveState = ref<DocumentSaveState>('clean')
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp({
      setup: () => () =>
        h(DocumentHeader, {
          session: fromPartial<DocumentSession>(session(40)),
          titleLabel: 'Spreadsheet title',
          saveState: saveState.value,
        }),
    })
    app.mount(root)
    cleanup = () => {
      app.unmount()
      root.remove()
    }

    saveState.value = 'saving'
    await nextTick()
    saveState.value = 'clean'
    await nextTick()

    expect(root.textContent).toContain('Edited just now')
  })

  it('gives the exact times and the creator on hovering the edited time', () => {
    const { root } = mount(session(40), { saveState: 'clean' })
    const details = root.querySelector('[role="tooltip"]')!.textContent
    expect(details).toMatch(/Edited .*\d{4}/)
    expect(details).toMatch(/Created .*2026.* by Asha Rao/)
  })

  it('says why saving is held up in place of the edited time', () => {
    const { root } = mount(session(40), { saveState: 'unsaved', saveNote: 'Changes will sync' })
    expect(root.textContent).toContain('Changes will sync')
    expect(root.textContent).not.toContain('Edited')
  })

  it('says nothing about edits for content with no save state', () => {
    const { root } = mount(session(40), { saveState: null })
    expect(root.textContent).not.toContain('Edited')
  })

  it('stars and unstars, and offers no star to someone who cannot keep one', async () => {
    const doc = session(40)
    const { button } = mount(doc)
    button('Star')!.click()
    expect(doc.setStarred).toHaveBeenCalledWith(true)
    await nextTick()
    expect(button('Unstar')!.getAttribute('aria-pressed')).toBe('true')
    expect(button('Unstar')!.querySelector('.fill-current')).toBeTruthy()
    expect(button('Unstar')!.querySelector('.lucide-star')).toBeNull()
    cleanup?.()

    const linkOnly = session(40)
    linkOnly.canStar.value = false
    expect(mount(linkOnly).button('Star')).toBeNull()
  })

  it('copies the address of the page', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { button } = mount(session(40))
    button('Copy link')!.click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href))
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
    ['with its label', {}, true],
    [
      'as an icon on every width, after a primary action',
      { primary: () => h('button', 'Present') },
      false,
    ],
  ])('shows Share %s', (_label, slots, hasLabel) => {
    const sharer = session(40)
    const { root, button } = mount(sharer, {}, slots)
    const labelled = [...root.querySelectorAll('button')].find((el) => el.textContent === 'Share')

    expect(!!labelled).toBe(hasLabel)
    expect(button('Share')!.classList.contains('md:hidden')).toBe(hasLabel)
    labelled?.click()
    button('Share')!.click()
    expect(sharer.share).toHaveBeenCalledTimes(hasLabel ? 2 : 1)
  })

  it('puts the menu after Star and before the primary action', () => {
    const { root } = mount(
      session(40),
      {},
      { menu: () => h('button', 'Menu'), primary: () => h('button', 'Present') },
    )
    const labels = [...root.querySelectorAll('header > div:last-child button')].map(
      (el) => el.getAttribute('aria-label') ?? el.textContent,
    )
    expect(labels.slice(-4)).toEqual(['Copy link', 'Star', 'Menu', 'Present'])
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
            session: fromPartial<DocumentSession>(session(40)),
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
    const edited = [...header.querySelectorAll('span')].find(
      (el) => el.textContent?.trim() === 'Edited 3h ago',
    )!
    return { header, edited, menus: header.querySelector('nav')! }
  }

  it('puts the edited time beside the title, then the menus', () => {
    const { header, edited, menus } = mountWithMenus(true)
    const left = header.firstElementChild!
    expect(left.contains(edited)).toBe(true)
    expect(edited.compareDocumentPosition(menus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(left.contains(menus)).toBe(true)
  })

  it('puts the edited time on the right for every other app', () => {
    const { header, edited } = mountWithMenus(false)
    expect(header.firstElementChild!.contains(edited)).toBe(false)
    expect(header.lastElementChild!.contains(edited)).toBe(true)
  })
})

function requireTestElement<T extends Element>(
  value: unknown,
  constructor: new (...args: never[]) => T,
): T {
  if (!(value instanceof constructor)) throw new Error(`Expected ${constructor.name}`)
  return value
}
