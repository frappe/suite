import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import UsersBar from '@/apps/writer/components/UsersBar.vue'
import { translate } from '@/platform/translation'

vi.mock('frappe-ui', () => ({
  Avatar: defineComponent({ setup: () => () => h('span') }),
  Dropdown: defineComponent({
    props: { options: Array },
    setup:
      (props, { slots }) =>
      () =>
        h('div', [
          slots.default?.(),
          h(
            'ul',
            { class: 'menu' },
            (props.options ?? []).map((item) => h('li', slots.item?.({ item }))),
          ),
        ]),
  }),
  Tooltip: defineComponent({
    props: { text: String },
    setup:
      (props, { slots }) =>
      () =>
        h('div', { class: 'tooltip', title: props.text }, slots.default?.()),
  }),
}))

// The people search knows Ada's email; it never returns the Administrator account
vi.mock('@/apps/writer/composables/useUsers', () => ({
  useUsers: () => ({
    getUser: (user: string) => (user === 'ada@x.com' ? { email: 'ada@x.com' } : undefined),
  }),
}))

const MINUTE_MS = 60_000
const TICK_MS = 30_000
const IDLE_FOR_MS = 4.5 * MINUTE_MS

let cleanup: (() => void) | undefined

vi.stubGlobal('__', translate)

afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
})

function mount(users: object[]) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ setup: () => () => h(UsersBar, { users }) })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }

  return root
}

function avatarsOf(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('.peer-slot')].map((avatar) => ({
    isDimmed: avatar.classList.contains('peer-idle'),
    tooltip: avatar.querySelector('.tooltip')?.getAttribute('title'),
  }))
}

describe('UsersBar', () => {
  it('dims an idle person and counts their idle minutes in the tooltip as they pass', async () => {
    vi.useFakeTimers()
    const idleSince = Date.now() - IDLE_FOR_MS
    const root = mount([
      { name: 'Ada Lovelace', id: 'ada@x.com', color: '#000', idleSince },
      { name: 'Bo Chen', id: 'bo@x.com', color: '#000', idleSince: null },
    ])

    const before = avatarsOf(root)
    await vi.advanceTimersByTimeAsync(TICK_MS)
    await nextTick()
    const [ada] = avatarsOf(root)

    expect(before).toEqual([
      { isDimmed: true, tooltip: 'Ada Lovelace · Idle for 4 min' },
      { isDimmed: false, tooltip: 'Bo Chen' },
    ])
    expect(ada.tooltip).toBe('Ada Lovelace · Idle for 5 min')
  })
  it('draws a person in the list as in the row: their initials on their colour', () => {
    const root = mount([
      { name: 'Ada Lovelace', id: 'ada@x.com', color: '#123456', idleSince: null },
    ])
    const drawn = (selector: string) => {
      const chip = root.querySelector<HTMLElement>(`${selector} .peer-initials`)!
      return [chip.textContent?.trim(), chip.style.getPropertyValue('--peer-light')]
    }

    expect(drawn('.menu')).toEqual(drawn('.peer-slot'))
    expect(drawn('.menu')).toEqual(['AL', '#123456'])
  })
  it('names a person once in the list, with their email underneath when it says more', () => {
    const root = mount([
      { name: 'Ada Lovelace', id: 'ada@x.com', color: '#000', idleSince: null },
      { name: 'Administrator', id: 'Administrator', color: '#000', idleSince: null },
    ])
    const rows = [...root.querySelectorAll('.menu li')].map((row) =>
      [...row.querySelectorAll('.flex-col span')].map((line) => line.textContent),
    )

    expect(rows).toEqual([['Ada Lovelace', 'ada@x.com'], ['Administrator']])
  })
})
