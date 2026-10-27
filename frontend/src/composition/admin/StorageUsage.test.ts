import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import StorageUsage from './StorageUsage.vue'

vi.mock(
  'frappe-ui',
  async () => import('../../../../node_modules/frappe-ui/src/components/Progress'),
)

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function render(drive: number, mail: number | null, cap: number | null) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp(StorageUsage, {
    user: { drive_bytes: drive, mail_bytes: mail, cap_bytes: cap },
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return root
}

it.each([
  [2e9, 3e9, 10e9, '50'],
  [0, 0, 10e9, '0'],
  [12e9, 3e9, 10e9, '100'],
  [-1e9, 0, 10e9, '0'],
])(
  'exposes bounded storage usage for %s Drive bytes and %s Mail bytes',
  (drive, mail, cap, value) => {
    const root = render(drive, mail, cap)
    const bar = root.querySelector('[role="progressbar"]:not([aria-hidden])')
    expect(bar?.getAttribute('aria-label')).toBe('Storage usage')
    expect(bar?.getAttribute('aria-valuenow')).toBe(value)
    expect(bar?.getAttribute('aria-valuemin')).toBe('0')
    expect(bar?.getAttribute('aria-valuemax')).toBe('100')
  },
)

it('keeps actual usage and limit readable above the cap', () => {
  const root = render(12e9, 3e9, 10e9)
  expect(root.textContent).toContain('15 GB')
  expect(root.textContent).toContain('of 10 GB')
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe(
    '15 GB of 10 GB used',
  )
})

it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  'does not show a quota bar for an unusable limit of %s',
  (cap) => {
    const root = render(2e9, 3e9, cap)
    expect(root.querySelector('[role="progressbar"]')).toBeNull()
    expect(root.textContent).toContain('5 GB')
  },
)

it('does not present incomplete Mail usage as a complete percentage', () => {
  const root = render(2e9, null, 10e9)
  expect(root.querySelector('[role="progressbar"]')).toBeNull()
  expect(root.textContent).toContain('2 GB')
})
