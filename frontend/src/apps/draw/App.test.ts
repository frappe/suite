import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

import App from './App.vue'
import { DRAWING_PERSISTENCE, type DrawingPersistence } from './canvas/persistence'

const picker = vi.hoisted(() => vi.fn())
vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))
vi.mock('./components/InfiniteCanvas.vue', () => ({
  default: {
    setup(_props: unknown, { expose }: { expose: (value: unknown) => void }) {
      expose({ openImagePicker: picker })
      return () => h('div')
    },
  },
}))
vi.mock('./components/DrawingToolbar.vue', () => ({
  default: {
    props: ['activeTool'],
    setup(props: { activeTool: string }) {
      return () => h('span', { 'data-tool': props.activeTool })
    },
  },
}))
let cleanup: () => void

afterEach(() => {
  cleanup?.()
  vi.clearAllMocks()
})

it('routes tool shortcuts through one activation owner and ignores text inputs and modifiers', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(App)
  app.provide(DRAWING_PERSISTENCE, {
    drawingTitle: ref('Drawing'),
    editable: ref(true),
    dirty: ref(false),
    saving: ref(false),
    drawingLoading: ref(false),
    loadError: ref(false),
    session: { canShare: ref(false) },
  } as unknown as DrawingPersistence)
  app.mount(host)
  cleanup = () => {
    app.unmount()
    host.remove()
  }
  for (const [key, tool] of [
    ['r', 'rectangle'],
    ['d', 'diamond'],
    ['o', 'ellipse'],
    ['l', 'line'],
    ['a', 'arrow'],
    ['t', 'text'],
    ['p', 'draw'],
    ['0', 'eraser'],
    ['k', 'laser'],
  ]) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }))
    await nextTick()
    expect(host.querySelector('[data-tool]')?.getAttribute('data-tool')).toBe(tool)
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', cancelable: true }))
  expect(picker).toHaveBeenCalledOnce()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }))
  const input = document.createElement('input')
  host.append(input)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))
  await nextTick()
  expect(host.querySelector('[data-tool]')?.getAttribute('data-tool')).toBe('image')
})
