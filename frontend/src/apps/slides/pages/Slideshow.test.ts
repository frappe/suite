import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'

vi.mock('frappe-ui', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useKeyboardShortcut: (
    await import('../../../../../node_modules/frappe-ui/src/composables/useKeyboardShortcut')
  ).useKeyboardShortcut,
}))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => undefined } }))
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { slides, slideIndex } = await import('@/apps/slides/stores/slide')
const { slidesLength } = await import('@/apps/slides/stores/presentation')
const { endSlideShow, startSlideShow } = await import('@/apps/slides/stores/slideshow')
const { default: Slideshow } = await import('./Slideshow.vue')

let app: App | null = null

async function present() {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  startSlideShow()
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp(Slideshow)
  app.mount(host)
  await nextTick()
  return trigger
}

async function press(key: string) {
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  await nextTick()
  await nextTick()
}

beforeEach(() => {
  slides.value = [{ elements: [] }, { elements: [] }, { elements: [] }]
  slidesLength.value = 3
  slideIndex.value = 1
  // jsdom has no fullscreen; the show only needs the request to succeed
  document.exitFullscreen = async () => {}
  document.documentElement.requestFullscreen = async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    })
  }
})

afterEach(() => {
  app?.unmount()
  app = null
  endSlideShow()
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
  document.body.replaceChildren()
})

describe('presenting', () => {
  it('takes the keyboard from the control that started it', async () => {
    const trigger = await present()

    expect([document.activeElement === trigger, document.activeElement?.tagName]).toEqual([
      false,
      'DIV',
    ])
  })

  it('takes the keyboard back when a closing menu drops focus onto the page', async () => {
    await present()
    const show = document.activeElement as HTMLElement

    show.blur()
    show.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    await new Promise((resolve) => setTimeout(resolve))

    expect(document.activeElement).toBe(show)
  })

  it('goes to the last slide on End and the first on Home', async () => {
    await present()

    await press('End')
    const afterEnd = slideIndex.value
    await press('Home')

    expect([afterEnd, slideIndex.value]).toEqual([2, 0])
  })
})
