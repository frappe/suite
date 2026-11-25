import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import SearchDateRangeSheet from '@/apps/mail/components/mobile/SearchDateRangeSheet.vue'
import { translationPlugin } from '@/platform/translation'

// The sheet open, its days as buttons named by their date, and Apply.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    BottomSheet: defineComponent({
      props: { open: Boolean },
      setup:
        (props, { slots }) =>
        () =>
          props.open ? h('div', slots.default?.()) : null,
    }),
    Button: defineComponent({
      props: { label: String, disabled: Boolean },
      emits: ['click'],
      setup:
        (props, { emit, attrs }) =>
        () =>
          h(
            'button',
            {
              'aria-label': attrs['aria-label'],
              disabled: props.disabled,
              onClick: () => emit('click'),
            },
            props.label,
          ),
    }),
  }
})

let unmount: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-24T12:00:00'))
})
afterEach(() => {
  unmount?.()
  vi.useRealTimers()
})

const openSheet = () => {
  const picked: { after?: string; before?: string }[] = []
  const root = document.body.appendChild(document.createElement('div'))
  const app = createApp({
    setup: () => () =>
      h(SearchDateRangeSheet, {
        open: true,
        onPick: (range: (typeof picked)[0]) => picked.push(range),
      }),
  })
  app.use(translationPlugin).mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  const day = (label: string) =>
    document.querySelector<HTMLButtonElement>(`[aria-label="${label} 2026"]`)!
  const button = (label: string) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === label)!
  const apply = () => button('Apply')
  return { picked, day, apply, button }
}

describe("a phone's custom date range", () => {
  it('searches from the first day tapped to the last, both in, a day before the first moving the start', async () => {
    const { picked, day, apply } = openSheet()

    day('15 November').click()
    await Promise.resolve()
    day('3 November').click()
    await Promise.resolve()
    day('15 November').click()
    await Promise.resolve()
    apply().click()

    expect(picked).toEqual([{ after: '2026-11-03', before: '2026-11-16' }])
  })

  it('searches mail after a day from one tap, the day itself out', async () => {
    const { picked, day, apply, button } = openSheet()

    button('After').click()
    await Promise.resolve()
    day('3 November').click()
    await Promise.resolve()
    apply().click()

    expect(picked).toEqual([{ after: '2026-11-04' }])
  })

  it('offers no day after today', () => {
    const { day } = openSheet()

    expect(day('24 November').disabled).toBe(false)
    expect(day('25 November').disabled).toBe(true)
  })
})
