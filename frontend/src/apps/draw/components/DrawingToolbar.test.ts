import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import type { DrawingTool } from '../canvas/tools'
import DrawingToolbar from './DrawingToolbar.vue'

vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))
vi.mock('frappe-ui', () => {
  const tooltip = defineComponent({
    setup(_props, { slots }) {
      return () => slots.default?.()
    },
  })
  return {
    Button: defineComponent({
      setup(_props, { attrs }) {
        return () => h('button', attrs)
      },
    }),
    Dropdown: defineComponent({
      props: ['button', 'options'],
      setup(_props, { attrs }) {
        return () => h('button', attrs)
      },
    }),
    Tooltip: tooltip,
    TooltipProvider: tooltip,
  }
})

let cleanup: () => void
afterEach(() => cleanup?.())

it('moves the pressed indicator from a drawing tool to More tools for overflow tools', async () => {
  const activeTool = ref<DrawingTool>('rectangle')
  const host = document.createElement('div')
  const app = createApp({
    render: () =>
      h(DrawingToolbar, {
        activeTool: activeTool.value,
        onSelect: (tool: DrawingTool) => (activeTool.value = tool),
      }),
  })
  app.mount(host)
  cleanup = () => app.unmount()

  expect(host.querySelector('[aria-label="Rectangle"]')?.getAttribute('aria-pressed')).toBe('true')
  host.querySelector<HTMLButtonElement>('[aria-label="Arrows"]')!.click()
  await nextTick()
  expect(activeTool.value).toBe('arrow')
  expect(host.querySelector('[aria-label="Rectangle"]')?.getAttribute('aria-pressed')).toBe('false')

  for (const tool of ['laser', 'image', 'lasso'] as const) {
    activeTool.value = tool
    await nextTick()
    expect(host.querySelector('[aria-label="More tools"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(host.querySelector('[aria-label="Arrows"]')?.getAttribute('aria-pressed')).toBe('false')
  }
})
