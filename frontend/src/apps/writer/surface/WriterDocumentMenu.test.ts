import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref, type PropType } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { DocumentSession } from '@/apps/drive'

import WriterDocumentMenu from './WriterDocumentMenu.vue'

interface MenuEntry {
  label?: string
  onClick?: () => void
  options?: MenuEntry[]
  submenu?: MenuEntry[]
}

// The menu's own rendering is frappe-ui's. This stand-in lists every item a
// person could reach, submenus included.
vi.mock('frappe-ui', () => {
  function items(entries: MenuEntry[]): MenuEntry[] {
    const reachable = entries.flatMap((entry) => [
      entry,
      ...items(entry.options ?? []),
      ...items(entry.submenu ?? []),
    ])
    return reachable.filter((entry) => entry.label)
  }

  return {
    Button: defineComponent({
      inheritAttrs: false,
      setup:
        (_props, { attrs }) =>
        () =>
          h('button', attrs),
    }),
    Dropdown: defineComponent({
      props: { options: { type: fromPartial<PropType<MenuEntry[]>>(Array), required: true } },
      setup:
        (props, { slots }) =>
        () =>
          h('div', [
            slots.default?.(),
            h(
              'ul',
              { role: 'menu' },
              items(props.options).map(({ label, onClick }) =>
                h('li', { role: 'menuitem', onClick }, label),
              ),
            ),
          ]),
    }),
  }
})
vi.mock('@/platform/feedback', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

const canStar = ref(true)
const setStarred = vi.fn(async () => {})
// A document shared with someone who views it, in a folder they cannot see
const session = fromPartial<DocumentSession>({
  nodeId: 'doc-1',
  title: ref('Plan'),
  state: ref<DocumentSession['state']['value']>('Active'),
  access: ref({ role: 10 }),
  folder: ref(null),
  credentials: {
    context: { partition: () => 'test', scope: () => ({}) },
    heldContext: { partition: () => 'test', scope: () => ({}) },
    group: vi.fn(),
    fetch: vi.fn(),
    fetchHeld: vi.fn(),
  },
  canStar,
  isStarred: ref(false),
  setStarred,
})

const router = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { render: () => null } }],
  })

let host: HTMLElement | null = null
let unmount = () => {}

function mountMenu(
  isEditable: boolean,
  canSaveVersion = false,
  onSaveVersion = () => {},
  lock: { canLock: boolean; isLocked: boolean; onSetLocked?: (lock: boolean) => void } = {
    canLock: false,
    isLocked: false,
  },
) {
  host = document.createElement('div')
  document.body.append(host)
  const app = createApp(() =>
    h(WriterDocumentMenu, {
      session,
      editor: null,
      settings: {},
      editable: isEditable,
      canSaveVersion,
      onSaveVersion,
      ...lock,
    }),
  )
  app.use(router()).mount(host)
  unmount = () => app.unmount()
  return [...host.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
}

// The menu's button, here disabled for want of an editor, takes focus as reka gives it back
function focusMenuButton() {
  host!.querySelector('button')!.dispatchEvent(new FocusEvent('focus'))
}

function pick(label: string) {
  const items = [...host!.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  items.find((item) => item.textContent === label)!.click()
}

// Picks Save version, and the menu closes, handing focus back to its button
function pickSaveVersion() {
  pick('Save version')
  focusMenuButton()
}

afterEach(() => {
  unmount()
  host?.remove()
  host = null
  canStar.value = true
  setStarred.mockClear()
})

describe('Writer document menu', () => {
  it('offers a reader neither Lock nor Unlock', () => {
    expect(mountMenu(false, false, () => {}, { canLock: false, isLocked: true })).not.toContain(
      'Unlock',
    )
  })

  it('locks an unlocked document and unlocks a locked one', () => {
    for (const isLocked of [false, true]) {
      const onSetLocked = vi.fn()
      const label = isLocked ? 'Unlock' : 'Lock'
      expect(mountMenu(false, false, () => {}, { canLock: true, isLocked, onSetLocked })).toContain(
        label,
      )

      pick(label)

      expect(onSetLocked).toHaveBeenCalledExactlyOnceWith(!isLocked)
      unmount()
      host?.remove()
    }
  })

  it('offers a reader Copy link, the exports and Star, but not Import DOCX', () => {
    expect(mountMenu(false)).toEqual(['Copy link', 'Export as DOCX', 'Export as Markdown', 'Star'])
  })

  it('offers an editor Import DOCX as well', () => {
    expect(mountMenu(true).slice(1, 4)).toEqual([
      'Export as DOCX',
      'Export as Markdown',
      'Import DOCX',
    ])
  })

  it('stars the document from the menu', () => {
    mountMenu(false)
    pick('Star')
    expect(setStarred).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('copies the address of the page from the menu', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    mountMenu(false)
    pick('Copy link')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href))
  })

  it('offers no Star to someone who cannot keep one, and still the link', () => {
    canStar.value = false
    expect(mountMenu(false)).toEqual(['Copy link', 'Export as DOCX', 'Export as Markdown'])
  })

  it('offers Save version first to someone who can save one, and picking it asks for a name', () => {
    const onSaveVersion = vi.fn()

    const items = mountMenu(true, true, onSaveVersion)
    pickSaveVersion()

    expect([items, onSaveVersion.mock.calls.length]).toEqual([
      ['Save version', 'Copy link', 'Export as DOCX', 'Export as Markdown', 'Import DOCX', 'Star'],
      1,
    ])
  })

  it('asks for the name only once the closing menu has given focus back to its button', () => {
    const onSaveVersion = vi.fn()
    mountMenu(true, true, onSaveVersion)

    focusMenuButton()
    pick('Save version')
    const beforeFocusBack = onSaveVersion.mock.calls.length
    focusMenuButton()
    focusMenuButton()

    expect([beforeFocusBack, onSaveVersion.mock.calls.length]).toEqual([0, 1])
  })

  it('forgets Save version when the person does something else before focus comes back', () => {
    const onSaveVersion = vi.fn()
    mountMenu(true, true, onSaveVersion)

    pick('Save version')
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    focusMenuButton()

    expect(onSaveVersion.mock.calls.length).toBe(0)
  })
})

describe('the side panels in the menu', () => {
  function showMenu(panels: ('comments' | 'versions')[]) {
    const toggled: string[] = []
    host = document.createElement('div')
    document.body.append(host)
    const app = createApp(() =>
      h(WriterDocumentMenu, {
        session,
        editor: null,
        settings: {},
        editable: false,
        canSaveVersion: false,
        canLock: false,
        isLocked: false,
        panels,
        onTogglePanel: (panel: string) => toggled.push(panel),
      }),
    )
    app.use(router()).mount(host)
    unmount = () => app.unmount()
    return { toggled, items: [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')] }
  }

  it('offers the panels this person can open, first, and toggles the one picked', () => {
    const { items, toggled } = showMenu(['comments', 'versions'])

    items[1].click()

    expect([items.slice(0, 2).map((item) => item.textContent), toggled]).toEqual([
      ['Comments', 'Versions'],
      ['versions'],
    ])
  })

  it('offers no panel that this person cannot open', () => {
    const { items } = showMenu(['comments'])

    expect(items.map((item) => item.textContent)).not.toContain('Versions')
  })

  it('stays usable for the panels before the editor has opened', () => {
    showMenu(['comments'])

    expect(host!.querySelector('button')!.disabled).toBe(false)
  })
})
