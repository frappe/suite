import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, ref, type App } from 'vue'

// The test build stubs frappe-ui; the shortcut registry is the real one.
vi.mock('frappe-ui', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useKeyboardShortcut: (
    await import('../../../../../node_modules/frappe-ui/src/composables/useKeyboardShortcut')
  ).useKeyboardShortcut,
}))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => undefined } }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { useShortcuts } = await import('./useShortcuts')
const { activeElementIds, focusElementId, pendingShapeType } =
  await import('@/apps/slides/stores/element')
const { slides, slideIndex } = await import('@/apps/slides/stores/slide')

let app: App
let clock = 0

// one key press on the canvas, `gap` ms after the one before
const press = (key: string, gap = 50) => {
  clock += gap
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'timeStamp', { value: clock })
  document.body.dispatchEvent(event)
}
const type = (text: string) => [...text].forEach((key) => press(key))

describe('tool letters on the slide canvas', () => {
  beforeEach(() => {
    clock = 10_000
    slides.value = [{ clientId: 'c1', background: '#ffffffff', elements: [] }] as never
    slideIndex.value = 0
    activeElementIds.value = []
    focusElementId.value = null
    pendingShapeType.value = null
    app = createApp(
      defineComponent({
        setup() {
          useShortcuts(ref(false), ref(false))
          return () => null
        },
      }),
    )
    app.mount(document.createElement('div'))
  })

  afterEach(() => app.unmount())

  it('arms the text tool on T and adds nothing until the user clicks', () => {
    press('t', 5_000)

    expect(pendingShapeType.value).toBe('text')
    expect(slides.value[0].elements).toEqual([])
  })

  it('arms a shape tool on a letter pressed on its own', () => {
    press('o', 5_000)

    expect(pendingShapeType.value).toBe('oval')
  })

  it('treats a typed sentence as typing, not as tool letters', () => {
    press('H', 5_000)
    type('ello team, total cost')

    expect(pendingShapeType.value).toBeNull()
    expect(slides.value[0].elements).toEqual([])
  })

  it('drops a tool when the letter that armed it starts a word', () => {
    press('o', 5_000)
    type('ver')

    expect(pendingShapeType.value).toBeNull()
  })
})
