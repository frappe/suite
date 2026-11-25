import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import MailRow from '@/apps/mail/components/MailRow.vue'

vi.mock('frappe-ui', async () => {
  const { defineComponent, h: render } = await import('vue')
  return {
    Avatar: defineComponent({ render: () => render('span', { class: 'avatar' }) }),
    Checkbox: defineComponent({ render: () => null }),
  }
})
vi.mock('@/apps/mail/components/MailDate.vue', async () => {
  const { defineComponent } = await import('vue')
  return { default: defineComponent({ render: () => null }) }
})
vi.mock('@/apps/mail/utils/composables', async () => {
  const { ref } = await import('vue')
  return { useScreenSize: () => ({ isMobile: ref(true) }) }
})

const mounted: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount()
})

// A phone row, ticked or not.
const row = (isSelected: boolean) => {
  const el = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MailRow, {
        isSelected,
        selectionMode: true,
        avatarLabel: 'Dana',
        selectLabel: 'Select Dana',
        datetime: '2026-11-06T10:00:00Z',
      }),
  })
  app.provide('$user', { data: { show_reading_pane: false } })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(el)
  mounted.push(app)
  const avatar = el.querySelector<HTMLElement>('.avatar')
  return {
    avatarShown: !!avatar && avatar.parentElement?.style.display !== 'none',
    ticked: !!avatar?.parentElement?.querySelector('svg'),
  }
}

it('keeps the sender in view on a phone, ticking the avatar of a selected row', () => {
  expect(row(true)).toEqual({ avatarShown: true, ticked: true })
  expect(row(false)).toEqual({ avatarShown: true, ticked: false })
})

// A finger landing on an unpicked phone row, or on its avatar, while rows are being picked or not:
// whether the row is shaded under it.
const shadedUnderFinger = async (selectionMode: boolean, onAvatar = false) => {
  const el = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MailRow, {
        isSelected: false,
        selectionMode,
        avatarLabel: 'Dana',
        datetime: '2026-11-06T10:00:00Z',
      }),
  })
  app.provide('$user', { data: { show_reading_pane: false } })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(el)
  mounted.push(app)
  // The row itself, the last child of the box it swipes in.
  const rowEl = el.firstElementChild!.lastElementChild!
  const target = onAvatar ? rowEl.querySelector('.avatar')! : rowEl
  target.dispatchEvent(
    Object.assign(new Event('touchstart', { bubbles: true }), {
      touches: [{ clientX: 10, clientY: 10 }],
    }),
  )
  await Promise.resolve()
  return rowEl.classList.contains('!bg-surface-gray-1')
}

it('shades a row under the finger as a long press’s hint, but not while a tap already picks it', async () => {
  expect(await shadedUnderFinger(false)).toBe(true)
  // Shaded, it blinked: off as the finger lifted, on again as the tap picked it
  expect(await shadedUnderFinger(true)).toBe(false)
  // A tap on the avatar picks the row too
  expect(await shadedUnderFinger(false, true)).toBe(false)
})

// iOS still clicks when a finger lifts after a long press. That click toggled the row the press had
// just picked straight back: a blink, or nothing picked at all.
it('picks a row once for a long press that iOS ends with a click', () => {
  vi.useFakeTimers()
  const picks: boolean[] = []
  const el = document.createElement('div')
  const app = createApp({
    render: () =>
      h(MailRow, {
        isSelected: false,
        selectionMode: true,
        avatarLabel: 'Dana',
        datetime: '2026-11-06T10:00:00Z',
        onSetSelected: (value: boolean) => picks.push(value),
      }),
  })
  app.provide('$user', { data: { show_reading_pane: false } })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(el)
  mounted.push(app)
  const rowEl = el.firstElementChild!.lastElementChild!
  rowEl.dispatchEvent(
    Object.assign(new Event('touchstart', { bubbles: true }), {
      touches: [{ clientX: 10, clientY: 10 }],
    }),
  )
  vi.advanceTimersByTime(600)
  rowEl.dispatchEvent(
    Object.assign(new Event('touchend', { bubbles: true }), {
      touches: [],
      changedTouches: [{ clientX: 10, clientY: 10 }],
    }),
  )
  rowEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  vi.useRealTimers()
  expect(picks).toEqual([true])
})
