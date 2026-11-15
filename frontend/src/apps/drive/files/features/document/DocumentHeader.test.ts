import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type VNode } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { DocumentSession } from '@/apps/drive/client/session'
import { requireTestElement } from '@/platform/testing/dom'
import { TransportError } from '@/platform/transport'

import DocumentHeader from './DocumentHeader.vue'
import DocumentHeaderSkeleton from './DocumentHeaderSkeleton.vue'
import type { DocumentSaveState } from './header'

// Plain stand-ins: the test frappe-ui build has no TextInput or Badge.
vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render, ref: reference } = await import('vue')
  return {
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
    Button: define({
      inheritAttrs: false,
      props: { label: String, route: [String, Object] },
      setup:
        (props, { attrs, slots }) =>
        () =>
          render(
            'button',
            {
              ...attrs,
              'data-to': typeof props.route === 'string' ? props.route : props.route?.path,
            },
            props.label ?? slots.icon?.() ?? slots.default?.(),
          ),
    }),
    // An open menu, so a test picks an item without opening it first
    Dropdown: define({
      props: {
        options: { type: Array<{ label: string; onClick: () => void }>, default: () => [] },
      },
      setup:
        (props, { slots }) =>
        () => [
          slots.default?.(),
          render(
            'div',
            { role: 'menu' },
            props.options.map((option) =>
              render('button', { role: 'menuitem', onClick: option.onClick }, option.label),
            ),
          ),
        ],
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
      setup: (props) => () => render('span', { 'data-badge': '' }, props.label),
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

const account = vi.hoisted(() => ({ status: { value: 'authenticated' } }))
vi.mock('@/platform/session', async (original) => {
  const actual = await original<typeof import('@/platform/session')>()
  return { ...actual, useSession: () => ({ ...actual.useSession(), status: account.status }) }
})
// Naming Drive's roots takes a query, so here every folder goes by its own title
vi.mock('@/apps/drive/files/internal/locations', async (original) => ({
  ...(await original()),
  useLocationTitle: () => (node: { title: string }) => node.title,
}))

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  account.status.value = 'authenticated'
  vi.restoreAllMocks()
})

function session(role: number, canShare = true) {
  return {
    nodeId: 'node-1',
    contentDoctype: 'Sheet',
    contentDocname: 'sheet-1',
    title: ref('Budget'),
    folder: ref<{ name: string; title: string; kind: string; role: number } | null>(null),
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
    stateBadge?: string
    layout?: 'default' | 'centered'
  } = {},
  slots: Record<string, () => VNode> = {},
) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup: () => () =>
      h(
        DocumentHeader,
        { session: fromPartial<DocumentSession>(doc), titleLabel: 'Spreadsheet title', ...props },
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
  const menuItem = (name: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (el) => el.textContent === name,
    )
  return { root, title, button, menuItem }
}

const badges = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-badge]')].map((el) => el.textContent)

/** What the header shows as buttons, by name, leaving out the items inside its menu. */
const buttons = (root: HTMLElement) =>
  [...root.querySelectorAll('header button:not([role="menuitem"])')].map(
    (el) => el.getAttribute('aria-label') ?? el.textContent,
  )

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

  it('keeps Copy link and Star in its menu, and shows neither as a button', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const doc = session(40)
    const { root, menuItem } = mount(doc)

    expect(buttons(root)).toEqual(['Back to Drive', 'Share', 'Share', 'More actions'])
    menuItem('Copy link')!.click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href))

    menuItem('Star')!.click()
    expect(doc.setStarred).toHaveBeenCalledWith(true)
    await nextTick()
    menuItem('Unstar')!.click()
    expect(doc.setStarred).toHaveBeenLastCalledWith(false)
  })

  it('offers no star to someone who cannot keep one, and still the link', () => {
    const linkOnly = session(40)
    linkOnly.canStar.value = false
    const { root } = mount(linkOnly)
    const items = [...root.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
    expect(items).toEqual(['Copy link'])
  })

  it.each([
    ['a trashed document', { trashed: true, saveState: 'failed', offline: true }, 'Trashed'],
    ['a failed save', { saveState: 'failed', offline: true }, 'Not saved'],
    ['no connection', { offline: true }, 'Offline'],
    ['the surface’s own state', {}, 'Locked'],
  ] as const)('shows one badge, and %s comes first', (_case, state, expected) => {
    const doc = session(40)
    if ('trashed' in state) doc.state.value = 'Trashed'
    if ('offline' in state) vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const saveState = 'saveState' in state ? state.saveState : 'clean'

    const { root } = mount(doc, { saveState, stateBadge: 'Locked', viewOnly: true })

    expect(badges(root)).toEqual([expected])
  })

  it('shows no badge on a document that is open to edit and saved', () => {
    expect(badges(mount(session(40), { saveState: 'clean' }).root)).toEqual([])
  })

  it('leads back to the folder the document is in', () => {
    const doc = session(40)
    doc.folder.value = { name: 'folder-9', title: 'Projects', kind: 'folder', role: 40 }
    const back = mount(doc).button('Back to Projects')!
    expect(back.dataset.to).toBe('/drive/f/folder-9/projects')
  })

  it('leads back to Drive when the person cannot read the folder', () => {
    expect(mount(session(40)).button('Back to Drive')!.dataset.to).toBe('/drive')
  })

  it('gives a guest no way back', () => {
    account.status.value = 'guest'
    expect(buttons(mount(session(10, false)).root)).toEqual(['More actions'])
  })

  it('puts the way back first, then the icon, the title and the badge', () => {
    const { root, title, button } = mount(session(10), { viewOnly: true })
    const order = [
      button('Back to Drive')!,
      root.querySelector('.file-icon-sheet')!,
      title,
      root.querySelector('[data-badge]')!,
    ]
    for (const [at, element] of order.slice(1).entries()) {
      expect(
        order[at]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
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
    ['on its own', {}],
    ['beside a primary action', { primary: () => h('button', 'Present') }],
  ])(
    'shows Share with its icon and the word on wide screens, the icon alone below, %s',
    (_, slots) => {
      const sharer = session(40)
      const { root, button } = mount(sharer, {}, slots)
      const worded = [...root.querySelectorAll('button')].find((el) => el.textContent === 'Share')!
      const iconOnly = button('Share')!

      expect(worded.getAttribute('icon-left')).toBe('lucide-share-2')
      expect([...worded.classList]).toContain('max-md:hidden')
      expect(iconOnly.getAttribute('icon')).toBe('lucide-share-2')
      expect([...iconOnly.classList]).toContain('md:hidden')
      worded.click()
      iconOnly.click()
      expect(sharer.share).toHaveBeenCalledTimes(2)
    },
  )

  it('keeps the order on the right: edited, people, Share, the menu, the primary action', () => {
    const { root, button } = mount(
      session(40),
      { saveState: 'clean' },
      {
        actions: () => h('span', { 'data-presence': '' }),
        menu: () => h('button', 'Menu'),
        primary: () => h('button', 'Present'),
      },
    )
    const named = (text: string) =>
      [...root.querySelectorAll('header > div:last-child *')].find(
        (el) => el.children.length === 0 && el.textContent?.trim() === text,
      )!
    const order = [
      named('Edited 3h ago'),
      root.querySelector('[data-presence]')!,
      button('Share')!,
      named('Menu'),
      named('Present'),
    ]
    for (const [at, element] of order.slice(1).entries()) {
      expect(
        order[at]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it('puts the primary action last', () => {
    const { root } = mount(session(40), {}, { primary: () => h('button', 'Present') })

    expect(root.querySelector('header > div:last-child > :last-child')!.textContent).toBe('Present')
  })
})

describe('DocumentHeaderSkeleton', () => {
  // The classes that size or hide what comes before the title, and the text it shows.
  const BOX = /^(max-md:hidden|md:hidden|max-w-\S+|px-\S+|ps-\S+|size-\S+|text-base|truncate)$/
  function layout(header: Element, title: Element) {
    const group = header.firstElementChild!
    const items = [...group.children].flatMap((child) =>
      child.classList.contains('contents') ? [...child.children] : [child],
    )
    const before = items.slice(0, items.indexOf(title))
    // frappe-ui draws an icon-only Button 28 px square, which its classes do not say.
    const classes = (item: Element) =>
      item.tagName === 'BUTTON' ? [...item.classList, 'size-7'] : [...item.classList]
    const signature = (item: Element) => [
      classes(item)
        .filter((name) => BOX.test(name))
        .sort(),
      item.textContent?.trim(),
    ]
    return {
      before: before.map(signature),
      titleStart: [...title.classList].find((name) => /^p[sx]-/.test(name)),
    }
  }

  function mountPair(location: { label: string; to: string } | null) {
    const root = document.createElement('div')
    document.body.append(root)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:any(.*)', component: { render: () => null } }],
    })
    const doc = { ...session(40), contentDoctype: 'Drive File', title: ref('Loose file.txt') }
    const app = createApp({
      setup: () => () => [
        h(DocumentHeaderSkeleton, { title: 'Loose file.txt', location: location?.label }),
        h(DocumentHeader, {
          session: fromPartial<DocumentSession>(doc),
          titleLabel: 'File name',
          mime: 'text/plain',
          location,
        }),
      ],
    }).use(router)
    app.mount(root)
    cleanup = () => {
      app.unmount()
      root.remove()
    }
    const [skeleton, loaded] = root.querySelectorAll('header')
    return {
      skeleton: layout(skeleton!, skeleton!.querySelector('span.font-medium')!),
      loaded: layout(loaded!, loaded!.querySelector('.document-title')!),
      loadedTitle: loaded!.querySelector('.document-title > span')!,
    }
  }

  it('lays out the way back and the icon as the loaded file header does', () => {
    const { skeleton, loaded, loadedTitle } = mountPair({
      label: 'Projects',
      to: '/drive/f/projects',
    })

    expect(skeleton.before).toEqual(loaded.before)
    // The way back then the icon, and the folder's name shows nowhere
    expect(skeleton.before.map(([, text]) => text)).toEqual(['', ''])
    // Both titles start 8 px in: the skeleton's text, and the copy that sizes the field.
    expect(skeleton.titleStart).toBe('px-2')
    expect(loadedTitle.classList).toContain('ps-2')
  })

  it('shows only the icon before the title when the file has no folder to name', () => {
    const { skeleton, loaded } = mountPair(null)

    expect(skeleton.before).toEqual(loaded.before)
    expect(skeleton.before).toHaveLength(1)
  })
})
