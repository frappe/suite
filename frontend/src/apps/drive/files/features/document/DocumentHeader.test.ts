import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type VNode } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { DocumentSession } from '@/apps/drive/client/session'
import { requireTestElement } from '@/platform/testing/dom'
import { TransportError } from '@/platform/transport'

import type { DocumentPanel } from '../../../client/types'
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
    layout?: 'default' | 'centered' | 'menus'
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

  it('lays out the folder, the way back and the icon as the loaded file header does', () => {
    const { skeleton, loaded, loadedTitle } = mountPair({
      label: 'Projects',
      to: '/drive/f/projects',
    })

    expect(skeleton.before).toEqual(loaded.before)
    expect(skeleton.before.map(([, text]) => text)).toEqual(['', 'Projects', '/', ''])
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

describe('DocumentHeader, menus layout (Sheets)', () => {
  function mountWithMenus(layout: 'default' | 'menus', props: { viewOnly?: boolean } = {}) {
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
            layout,
            ...props,
          },
          {
            menus: () => h('nav', { 'aria-label': 'Spreadsheet menus' }, 'File Edit'),
            actions: () => h('span', { 'data-presence': '' }),
          },
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
    const title = header.querySelector<HTMLInputElement>('input')!
    return { header, edited, title, menus: header.querySelector('nav')! }
  }

  it('is as tall as the other document headers', () => {
    expect(mountWithMenus('menus').header.className).toContain('h-12')
  })

  it('puts the title left, the menus in a column of their own, and the rest right', () => {
    const { header, edited, menus, title } = mountWithMenus('menus')
    const [left, middle, right] = header.children
    expect(header.children).toHaveLength(3)
    expect(left!.contains(title)).toBe(true)
    expect(left!.contains(edited)).toBe(false)
    expect(middle!.contains(menus)).toBe(true)
    expect(right!.contains(edited)).toBe(true)
  })

  it('keeps Writer’s order on the right: edited, presence, share, link, star', () => {
    const { header, edited } = mountWithMenus('menus')
    const order = [
      edited,
      header.querySelector('[data-presence]')!,
      header.querySelector('button[aria-label="Copy link"]')!,
      header.querySelector('button[aria-label="Star"]')!,
    ]
    for (const [at, element] of order.slice(1).entries()) {
      expect(
        order[at]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it('holds the badges apart from the title, so a longer title cannot push them', () => {
    const { header, title } = mountWithMenus('menus', { viewOnly: true })
    const badge = [...header.querySelectorAll('span')].find(
      (el) => el.textContent?.trim() === 'View only',
    )!
    const spacer = badge.previousElementSibling!
    expect(spacer.className).toContain('flex-1')
    expect(spacer.contains(title)).toBe(false)
  })

  function makeTitleOverflow(title: HTMLInputElement, overflows: boolean) {
    Object.defineProperty(title, 'clientWidth', { value: 400 })
    Object.defineProperty(title, 'scrollWidth', { value: overflows ? 900 : 400 })
  }
  const fullTitle = (header: HTMLElement) => header.querySelector('.document-full-title')

  it('shows the whole name under a title too long for its field, while it is clicked into', async () => {
    const { header, title } = mountWithMenus('menus')
    makeTitleOverflow(title, true)

    title.focus()
    await nextTick()
    expect(fullTitle(header)?.textContent).toBe('Budget')

    title.value = 'Budget 2027'
    title.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await nextTick()
    expect(fullTitle(header)?.textContent).toBe('Budget 2027')

    title.blur()
    await nextTick()
    expect(fullTitle(header)).toBeNull()
  })

  it('shows no second copy of a name that fits', async () => {
    const { header, title } = mountWithMenus('menus')
    makeTitleOverflow(title, false)

    title.focus()
    await nextTick()
    expect(fullTitle(header)).toBeNull()
  })

  it('leaves every other app’s header as it was', async () => {
    const { header, edited, menus, title } = mountWithMenus('default')
    makeTitleOverflow(title, true)
    expect(header.className).toContain('flex')
    expect(header.className).not.toContain('grid')
    expect(header.children).toHaveLength(2)
    expect(header.firstElementChild!.contains(menus)).toBe(true)
    expect(header.lastElementChild!.contains(edited)).toBe(true)

    title.focus()
    await nextTick()
    expect(fullTitle(header)).toBeNull()
  })
})
