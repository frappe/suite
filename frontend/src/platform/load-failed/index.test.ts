import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'

import { LoadFailed } from './index'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../node_modules/frappe-ui/src/components/Button')),
}))

let app: App | undefined
let root: HTMLDivElement
afterEach(() => {
  app?.unmount()
  root.remove()
})

function mount(retry: () => Promise<unknown>, variant: 'page' | 'section') {
  root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    render: () => h(LoadFailed, { title: 'Could not load domains', retry, variant }),
  })
  app.mount(root)
  const button = root.querySelector('button')
  if (!button) throw new Error('Retry button is missing')
  return button
}

describe.each(['page', 'section'] as const)('%s load failure', (variant) => {
  it('names the failed read and keeps retry pending until the read settles', async () => {
    let finish: (() => void) | undefined
    let calls = 0
    const button = mount(() => {
      calls++
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    }, variant)
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Could not load domains')
    expect(root.textContent).not.toContain('Something went wrong')
    expect(button.textContent).toContain('Retry')
    button.click()
    await nextTick()
    expect(calls).toBe(1)
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    finish?.()
    await nextTick()
    await nextTick()
    expect(button.disabled).toBe(false)
    expect(button.hasAttribute('aria-busy')).toBe(false)
  })

  it('keeps a rejected retry private and allows another attempt', async () => {
    let calls = 0
    const button = mount(async () => {
      calls++
      throw new Error('Private server details')
    }, variant)
    button.click()
    await nextTick()
    await nextTick()
    expect(root.textContent).not.toContain('Private server details')
    expect(button.disabled).toBe(false)
    button.click()
    await nextTick()
    expect(calls).toBe(2)
  })
})
