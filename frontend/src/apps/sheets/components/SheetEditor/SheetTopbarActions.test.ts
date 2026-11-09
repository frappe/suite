import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, type VNode } from 'vue'

import { PALETTE } from '@/platform/collab/colours'

import SheetTopbarActions from './SheetTopbarActions.vue'

vi.mock('frappe-ui', () => ({
  Avatar: { props: ['image'], setup: (p: { image: string }) => () => h('img', { src: p.image }) },
  Tooltip: {
    props: ['text'],
    setup:
      (p: { text: string }, { slots }: { slots: { default: () => VNode[] } }) =>
      () =>
        h('span', { 'data-tooltip': p.text }, slots.default()),
  },
}))

let unmount: () => void
afterEach(() => unmount())

const person = (over: { user_image?: string; sub_sheet?: string }) => ({
  user: 'ann@x',
  initials: 'AL',
  full_name: 'Ann Lee',
  user_image: '',
  sub_sheet: 'Sheet1',
  colour: PALETTE[0]!,
  ...over,
})

function render(presentUsers: ReturnType<typeof person>[], currentSheet = 'Sheet1') {
  const root = document.createElement('div')
  const app = createApp(SheetTopbarActions, { presentUsers, currentSheet })
  app.mount(root)
  unmount = () => app.unmount()
  return root
}

describe('the people in the top bar', () => {
  it('draws someone with no photo as initials in their tint and ink', () => {
    const root = render([person({})])
    const chip = root.querySelector<HTMLElement>('.sn-presence-initials')!
    expect(chip.textContent).toContain('AL')
    expect(chip.classList.contains('sn-peer')).toBe(true)
    expect(chip.style.getPropertyValue('--peer-light-tint')).toBe('#e6f4fe')
    expect(chip.style.getPropertyValue('--peer-light-ink')).toBe('#0d70c7')
  })

  it('shows a photo with no chip', () => {
    const root = render([person({ user_image: '/ann.png' })])
    expect(root.querySelector('img')!.getAttribute('src')).toBe('/ann.png')
    expect(root.querySelector('.sn-presence-initials')).toBeNull()
  })

  it('says who it is on hover, and which sheet when it is another one', () => {
    const elsewhere = render([person({ sub_sheet: 'Sheet2' })])
    expect(elsewhere.querySelector('[data-tooltip]')!.getAttribute('data-tooltip')).toBe(
      'Ann Lee — on Sheet2',
    )
    unmount()
    const here = render([person({})])
    expect(here.querySelector('[data-tooltip]')!.getAttribute('data-tooltip')).toBe('Ann Lee')
  })
})
