// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, ref, type App } from 'vue'

const presentationDoc = ref<Record<string, unknown> | null>(null)
const slides = ref([{ clientId: 'a' }, { clientId: 'b' }])
const execute = vi.fn()

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: (options: { value: { count: number } }) =>
    computed(() => ({
      getVirtualItems: () =>
        Array.from({ length: options.value.count }, (_, index) => ({
          index,
          key: index,
          start: index * 124,
          end: (index + 1) * 124,
          size: 124,
        })),
      getTotalSize: () => options.value.count * 124,
      scrollToIndex: () => {},
    })),
}))
// the read-only view never draws the menu
vi.mock('frappe-ui', () => ({ ContextMenu: {} }))
vi.mock('@/apps/slides/components/ThumbnailContainer.vue', () => ({
  default: defineComponent({ setup: () => () => h('div') }),
}))
vi.mock('@/apps/slides/stores/presentation', () => ({
  presentationDoc,
  slidesLength: computed(() => slides.value.length),
}))
vi.mock('@/apps/slides/stores/slide', () => ({
  slides,
  slideIndex: ref(0),
  focusedSlide: ref(null),
}))
vi.mock('@/apps/slides/stores/element', () => ({ resetFocus: vi.fn() }))
vi.mock('@/apps/slides/stores/historyMeta', () => ({ commandHistory: { execute } }))
vi.mock('@/apps/slides/stores/commands', () => ({
  reorderSlidesCommand: (change: unknown) => change,
}))
vi.mock('@/apps/slides/utils/slideMenu', () => ({ buildSlideContextOptions: () => [] }))

const { default: NavigationPanel } = await import('./NavigationPanel.vue')

let app: App | null = null
let root: HTMLElement

beforeEach(() => {
  presentationDoc.value = { name: 'p1' }
  execute.mockClear()
  root = document.createElement('div')
  document.body.append(root)
})

afterEach(() => {
  app?.unmount()
  app = null
  root.remove()
})

async function dragFirstSlideDown() {
  app = createApp({ render: () => h(NavigationPanel) })
  app.provide('inReadonlyMode', ref(true))
  app.mount(root)
  await nextTick()

  const row = root.querySelector('.virtual-row-wrapper')!
  row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 10 }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientY: 200 }))
  window.dispatchEvent(new MouseEvent('mouseup', { clientY: 200 }))
}

describe('dragging a thumbnail in the read-only view', () => {
  it('moves the slide in a presentation not converted yet, as develop does', async () => {
    await dragFirstSlideDown()

    expect(execute).toHaveBeenCalledWith({ oldIndex: 0, newIndex: 1 })
  })

  it('moves nothing in a converted presentation, which is read-only until live editing', async () => {
    presentationDoc.value = { name: 'p1', is_converted: 1 }

    await dragFirstSlideDown()

    expect(execute).not.toHaveBeenCalled()
  })
})
