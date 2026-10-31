import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type Component } from 'vue'

import ContentPane from '@/shell/ContentPane.vue'

vi.mock('frappe-ui', () => {
  const passthrough = defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h('div', attrs, slots.default?.())
    },
  })
  return {
    PageHeader: passthrough,
    PageHeaderMobile: passthrough,
    PageHeaderTitle: passthrough,
    SidebarItem: passthrough,
    SidebarLabel: passthrough,
  }
})

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

describe.each([1280, 390])('shell mount seam at %ipx', (width) => {
  it('mounts shell scrolling, content scrolling and a full-pane canvas without product branches', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: width,
    })
    const LongList = defineComponent({
      setup: () => () =>
        h(
          'div',
          { 'data-long-list': '' },
          Array.from({ length: 200 }, (_, index) => h('div', { class: 'h-9' }, `Row ${index + 1}`)),
        ),
    })
    const files = mount(
      defineComponent({
        setup: () => () => h(ContentPane, { scroll: 'shell' }, { default: () => h(LongList) }),
      }),
    )
    expect(files.querySelector('[data-scroll-owner="shell"]')).not.toBeNull()
    expect(files.querySelector('[data-scroll-owner="shell"]')?.className).not.toContain(
      'overflow-hidden',
    )
    expect(files.querySelectorAll('[data-long-list] > div')).toHaveLength(200)

    const content = mount(
      defineComponent({
        setup: () => () =>
          h(
            ContentPane,
            { scroll: 'content' },
            {
              default: () =>
                h('div', {
                  'data-self-scroll': '',
                  class: 'h-full overflow-auto',
                }),
            },
          ),
      }),
    )
    expect(content.querySelector('[data-scroll-owner="content"]')?.className).toContain(
      'overflow-hidden',
    )
    expect(content.querySelector('[data-self-scroll]')?.className).toContain('overflow-auto')

    // An open document is an ordinary in-shell route that owns its scrolling
    // and draws no sidebar. It gets the same content box, full size.
    const documentPane = mount(
      defineComponent({
        setup: () => () =>
          h(
            ContentPane,
            { scroll: 'content' },
            {
              default: () => h('canvas', { width: 960, height: 540, 'data-fixed-canvas': '' }),
            },
          ),
      }),
    )
    const pane = documentPane.querySelector('[data-scroll-owner="content"]')
    expect(pane?.className).toContain('overflow-hidden')
    expect(pane?.className).toContain('min-w-0')
    expect(documentPane.querySelector('[data-fixed-canvas]')?.getAttribute('width')).toBe('960')
  })
})

function mount(component: Component): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(component)
  app.mount(root)
  cleanups.push(() => {
    app.unmount()
    root.remove()
  })
  return root
}
