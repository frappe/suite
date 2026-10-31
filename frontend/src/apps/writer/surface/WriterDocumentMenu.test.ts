import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref, type PropType } from 'vue'

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
      props: { options: { type: Array as PropType<MenuEntry[]>, required: true } },
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
vi.mock('@/platform/feedback', () => ({ toast: { error: vi.fn() } }))

const session = {
  nodeId: 'doc-1',
  title: ref('Plan'),
  credentials: {
    context: { partition: () => 'test', scope: () => ({}) },
    heldContext: { partition: () => 'test', scope: () => ({}) },
    group: vi.fn(),
    fetch: vi.fn(),
    fetchHeld: vi.fn(),
  },
}

let host: HTMLElement | null = null
let unmount = () => {}

function mountMenu(isEditable: boolean, canSaveVersion = false, onSaveVersion = () => {}) {
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
    }),
  )
  app.mount(host)
  unmount = () => app.unmount()
  return [...host.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
}

// The menu's button, here disabled for want of an editor, takes focus as reka gives it back
function focusMenuButton() {
  host!.querySelector('button')!.dispatchEvent(new FocusEvent('focus'))
}

// Picks Save version, and the menu closes, handing focus back to its button
function pickSaveVersion() {
  host!.querySelector<HTMLElement>('[role="menuitem"]')!.click()
  focusMenuButton()
}

afterEach(() => {
  unmount()
  host?.remove()
  host = null
})

describe('Writer document menu', () => {
  it('offers a reader the downloads but not Import DOCX', () => {
    expect(mountMenu(false)).toEqual(['Download as DOCX', 'Download as Markdown'])
  })

  it('offers an editor Import DOCX as well', () => {
    expect(mountMenu(true)).toEqual(['Download as DOCX', 'Download as Markdown', 'Import DOCX'])
  })

  it('offers Save version first to someone who can save one, and picking it asks for a name', () => {
    const onSaveVersion = vi.fn()

    const items = mountMenu(true, true, onSaveVersion)
    pickSaveVersion()

    expect([items, onSaveVersion.mock.calls.length]).toEqual([
      ['Save version', 'Download as DOCX', 'Download as Markdown', 'Import DOCX'],
      1,
    ])
  })

  it('asks for the name only once the closing menu has given focus back to its button', () => {
    const onSaveVersion = vi.fn()
    mountMenu(true, true, onSaveVersion)

    focusMenuButton()
    host!.querySelector<HTMLElement>('[role="menuitem"]')!.click()
    const beforeFocusBack = onSaveVersion.mock.calls.length
    focusMenuButton()
    focusMenuButton()

    expect([beforeFocusBack, onSaveVersion.mock.calls.length]).toEqual([0, 1])
  })

  it('forgets Save version when the person does something else before focus comes back', () => {
    const onSaveVersion = vi.fn()
    mountMenu(true, true, onSaveVersion)

    host!.querySelector<HTMLElement>('[role="menuitem"]')!.click()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    focusMenuButton()

    expect(onSaveVersion.mock.calls.length).toBe(0)
  })
})
