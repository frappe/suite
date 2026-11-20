import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import StorageUsage from './StorageUsage.vue'

vi.mock('frappe-ui', async () => ({
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
  [400e6, 0, null, '400 MB'],
  [400e6, 0, 1e9, '400 MB / 1 GB'],
  [12e9, 3e9, 10e9, '15 GB / 10 GB'],
  [0, 0, 10e9, '0 MB / 10 GB'],
  [2e9, null, 10e9, '2 GB / 10 GB'],
])('shows usage and only a configured limit', (drive, mail, cap, expected) => {
  const root = render(drive, mail, cap)
  expect(root.textContent?.trim()).toBe(expected)
  expect(root.querySelector('[role="progressbar"]')).toBeNull()
  expect(root.querySelector('.lucide-info') !== null).toBe(mail === null)
})

it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
  'keeps an invalid limit distinct from unlimited',
  (cap) => {
    const root = render(2e9, 3e9, cap)
    expect(root.textContent).toContain('5 GB / Limit unavailable')
  },
)

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
  expect(root.textContent).toContain('0 MB')
  expect(root.textContent).toContain('/ 100 GB')
})

it('does not invent usage when the Drive measurement is unavailable', () => {
  const root = render(Number.NaN, null, 100e9)
  expect(root.querySelector('[role="progressbar"]')).toBeNull()
  expect(root.textContent).toContain('Storage usage unavailable')
})
