import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import StorageUsage from './StorageUsage.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../node_modules/frappe-ui/src/components/Progress')),
  ...(await import('../../../../node_modules/frappe-ui/src/components/Tooltip')),
}))

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  vi.unstubAllGlobals()
})

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
  expect(root.textContent).toBe('')
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe(
    '15 GB of 10 GB used',
  )
})

it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  'does not show a quota bar for an unusable limit of %s',
  (cap) => {
    const root = render(2e9, 3e9, cap)
    expect(root.querySelector('[role="progressbar"]')).toBeNull()
    expect(root.textContent).toContain(cap === null ? 'No limit' : 'Usage unavailable')
  },
)

it('does not present incomplete Mail usage as a complete percentage', () => {
  const root = render(2e9, null, 10e9)
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('20')
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe(
    'At least 2 GB of 10 GB used. Partial usage: Mail unavailable; total may be higher.',
  )
  expect(root.textContent).toBe('')
})

it('keeps app names out of the row and reveals their measurements on keyboard focus', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const root = render(2e9, null, 10e9)
  expect(root.textContent).not.toContain('Drive')
  expect(root.textContent).not.toContain('Mail')
  root.querySelector<HTMLElement>('[tabindex="0"]')!.focus()
  await vi.waitFor(() => {
    const tooltip = document.querySelector('[role="tooltip"]')
    expect(tooltip?.textContent).toContain('Drive')
    expect(tooltip?.textContent).toContain('2 GB')
    expect(tooltip?.textContent).toContain('Mail')
    expect(tooltip?.textContent).toContain('Unavailable')
    expect(tooltip?.textContent).toContain('At least 2 GB of 10 GB used')
    expect(tooltip?.textContent).toContain('total may be higher')
  })
})

it('keeps a zero known lower bound visible without inventing Mail usage', () => {
  const root = render(0, null, 100e9)
  const bar = root.querySelector('[role="progressbar"]')
  expect(bar?.getAttribute('aria-valuenow')).toBe('0')
  expect(bar?.getAttribute('aria-valuetext')).toContain('total may be higher')
  expect(root.textContent).toBe('')
})

it('does not invent usage when the Drive measurement is unavailable', () => {
  const root = render(Number.NaN, null, 100e9)
  expect(root.querySelector('[role="progressbar"]')).toBeNull()
  expect(root.textContent).toBe('Usage unavailable')
})
