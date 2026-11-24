import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'

import { useKeyboardInsets, watchOnScreenKeyboard } from '.'

// iPhone 17 Pro in Safari: the layout viewport stays 714 tall whatever the keyboard does.
const LAYOUT_HEIGHT = 714

/** The visible area, as iOS reports it: resized by the keyboard, scrolled by a pan. */
class VisibleArea extends EventTarget {
  height = LAYOUT_HEIGHT
  offsetTop = 0

  resizeTo(height: number) {
    this.height = height
    this.dispatchEvent(new Event('resize'))
  }

  panTo(offsetTop: number) {
    this.offsetTop = offsetTop
    this.dispatchEvent(new Event('scroll'))
  }
}

let app: App | undefined

const mountInsets = () => {
  const visible = new VisibleArea()
  vi.stubGlobal('innerHeight', LAYOUT_HEIGHT)
  vi.stubGlobal('visualViewport', visible)

  let insets!: ReturnType<typeof useKeyboardInsets>
  app = createApp(
    defineComponent({
      setup() {
        insets = useKeyboardInsets()
        return () => h('div')
      },
    }),
  )
  app.mount(document.createElement('div'))
  return { visible, insets }
}

afterEach(() => {
  app?.unmount()
  app = undefined
  vi.unstubAllGlobals()
})

describe('useKeyboardInsets', () => {
  it('covers nothing while the keyboard is down', () => {
    const { insets } = mountInsets()
    expect(insets.bottom.value).toBe(0)
  })

  it('reports the part of the screen the keyboard has taken', () => {
    const { visible, insets } = mountInsets()
    visible.resizeTo(377)
    expect(insets.height.value).toBe(377)
    expect(insets.bottom.value).toBe(337)
  })

  it('counts a pan as the visible area moving down, not as more keyboard', () => {
    const { visible, insets } = mountInsets()
    visible.resizeTo(377)
    visible.panTo(100)
    expect(insets.top.value).toBe(100)
    expect(insets.bottom.value).toBe(237)
  })

  it('covers nothing again once the keyboard closes', () => {
    const { visible, insets } = mountInsets()
    visible.resizeTo(377)
    visible.resizeTo(LAYOUT_HEIGHT)
    expect(insets.bottom.value).toBe(0)
  })
})

describe('watchOnScreenKeyboard', () => {
  // A phone 412 wide and 900 tall. `visible` is what is left of it to see: iOS shrinks only that
  // under its keyboard, Android the window as well.
  const screen = (window: number, visible = window) => {
    vi.stubGlobal('innerWidth', 412)
    vi.stubGlobal('innerHeight', window)
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: visible }))
  }
  const resize = (window: number, visible = window) => {
    screen(window, visible)
    globalThis.window.dispatchEvent(new Event('resize'))
  }

  let keyboard: ReturnType<typeof watchOnScreenKeyboard>
  let field: HTMLInputElement
  const typeIn = () => {
    vi.useFakeTimers()
    screen(900)
    keyboard = watchOnScreenKeyboard()
    field = document.body.appendChild(document.createElement('input'))
    field.focus()
    vi.advanceTimersByTime(20)
  }
  afterEach(() => {
    keyboard.stop()
    field.remove()
    vi.useRealTimers()
  })

  it('has none with a hardware keyboard, which takes none of the screen', () => {
    typeIn()
    expect(keyboard.up.value).toBe(false)
  })

  it("is up while iOS's keyboard takes the visible screen, the window its full height", () => {
    typeIn()
    resize(900, 520)
    expect(keyboard.up.value).toBe(true)
  })

  it("goes when Android's Back puts the keyboard away, the field still focused", () => {
    typeIn()
    resize(520)
    expect(keyboard.up.value).toBe(true)
    resize(900)
    expect(keyboard.up.value).toBe(false)
    expect(document.activeElement).toBe(field)
  })
})
