import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref, type PropType } from 'vue'

import WriterDocumentMenu from './WriterDocumentMenu.vue'

interface MenuEntry {
  label?: string
  options?: MenuEntry[]
  submenu?: MenuEntry[]
}

// The menu's own rendering is frappe-ui's. This stand-in lists every item a
// person could reach, submenus included.
vi.mock('frappe-ui', () => {
  const labels = (entries: MenuEntry[]): string[] =>
    entries.flatMap((entry) => [
      ...(entry.label ? [entry.label] : []),
      ...labels(entry.options ?? []),
      ...labels(entry.submenu ?? []),
    ])
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
              labels(props.options).map((label) => h('li', { role: 'menuitem' }, label)),
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

function mountMenu(editable: boolean) {
  host = document.createElement('div')
  document.body.append(host)
  const app = createApp(() =>
    h(WriterDocumentMenu, { session, editor: null, settings: {}, editable }),
  )
  app.mount(host)
  unmount = () => app.unmount()
  return [...host.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
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
})
