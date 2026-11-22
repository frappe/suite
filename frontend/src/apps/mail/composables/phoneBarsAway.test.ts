import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { useMobileSelection } from '@/apps/mail/utils/composables'

import { hidePhoneBarsOnScroll, liftToastsOver, usePhoneBarsAway } from './phoneBarsAway'

// A list 2000px tall in a 600px window.
const setUp = () => {
  const el = document.createElement('div')
  let top = 0
  Object.defineProperties(el, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 600 },
    scrollTop: { get: () => top, set: (v: number) => (top = v) },
  })
  const scope = effectScope()
  scope.run(() => hidePhoneBarsOnScroll(ref(el)))
  const scrollTo = (y: number) => {
    el.scrollTop = y
    el.dispatchEvent(new Event('scroll'))
  }
  return { scrollTo, scope, away: usePhoneBarsAway() }
}

describe('the phone bars while a list scrolls', () => {
  it('step aside going down and come back on the first scroll up', () => {
    const { scrollTo, scope, away } = setUp()
    scrollTo(300)
    expect(away.value).toBe(true)
    scrollTo(280)
    expect(away.value).toBe(false)
    scope.stop()
  })

  it('ignore a nudge too short to mean anything', () => {
    const { scrollTo, scope, away } = setUp()
    scrollTo(300)
    scrollTo(296)
    expect(away.value).toBe(true)
    scope.stop()
  })

  it('stay away through the bounce past the end of the list', () => {
    const { scrollTo, scope, away } = setUp()
    scrollTo(1400)
    scrollTo(1460)
    scrollTo(1400)
    expect(away.value).toBe(true)
    scope.stop()
  })

  it('come back when selecting starts, and when the page goes', async () => {
    const { scrollTo, scope, away } = setUp()
    const { setMobileSelectionActive } = useMobileSelection()
    scrollTo(300)
    setMobileSelectionActive(true)
    await nextTick()
    expect(away.value).toBe(false)
    setMobileSelectionActive(false)
    await nextTick()
    scrollTo(600)
    scope.stop()
    expect(away.value).toBe(false)
  })
})

describe('toasts on a phone', () => {
  const lift = () => document.documentElement.style.getPropertyValue('--mail-phone-bar')

  it('sit above the island of the bar in place, and drop while it is away or gone', async () => {
    const bar = ref<HTMLElement | null>(null)
    const barScope = effectScope()
    barScope.run(() => liftToastsOver(bar))
    // A 136px bar: Compose on top, and the island 68px from the top.
    const el = document.createElement('div')
    const island = document.createElement('nav')
    el.append(document.createElement('button'), island)
    Object.defineProperty(el, 'offsetHeight', { value: 136 })
    Object.defineProperty(island, 'offsetTop', { value: 68 })
    bar.value = el
    await nextTick()
    expect(lift()).toBe('68px')

    const { scrollTo, scope } = setUp()
    scrollTo(300)
    await nextTick()
    expect(lift()).toBe('0px')
    scope.stop()
    await nextTick()
    expect(lift()).toBe('68px')

    bar.value = null
    await nextTick()
    expect(lift()).toBe('0px')
    barScope.stop()
  })
})
