import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'

import { setTweaks } from '@/platform/tweaks'

import UploadCollisionDialog from './UploadCollisionDialog.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Checkbox')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/FormControl')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Radio')),
}))

let app: App | null = null
const choose = vi.fn()

async function openDialog(canReplace = true) {
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    setup: () => () =>
      h(UploadCollisionDialog, {
        title: 'report.pdf',
        freeTitle: 'report (2).pdf',
        canReplace,
        batch: true,
        open: true,
        onChoose: choose,
      }),
  })
  app.mount(root)
  await nextTick()
  await nextTick()
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const radioElements = () => [...dialog().querySelectorAll<HTMLElement>('[role="radio"]')]
const radios = () =>
  radioElements().map((radio) => radio.querySelector('[data-slot="label"]')?.textContent?.trim())
const buttons = () =>
  [...dialog().querySelectorAll('button:not([role="radio"]):not([role="checkbox"])')]
    .map((button) => button.textContent?.trim())
    .filter(Boolean)
const nameInput = () => dialog().querySelector<HTMLInputElement>('input[type="text"]')

async function pick(label: string) {
  const at = radios().indexOf(label)
  radioElements()[at]!.click()
  await nextTick()
  await nextTick()
}

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  choose.mockReset()
  setTweaks(['t11'], true)
})

describe('Duplicate-name dialog', () => {
  it('offers Keep both first, Skip only as a button, and the name field only for Rename', async () => {
    await openDialog()
    expect(radios()).toEqual(['Keep both', 'Replace', 'Rename'])
    expect(buttons().filter((text) => text === 'Skip')).toHaveLength(1)
    expect(buttons()).toContain('Keep both')
    expect(nameInput()).toBeNull()

    await pick('Rename')
    const input = nameInput()!
    expect(input.value).toBe('report (2).pdf')
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'report (2)'.length])
    expect(buttons()).toContain('Rename')

    await pick('Replace')
    expect(nameInput()).toBeNull()
    expect(buttons()).toContain('Replace')
  })

  it('keeps the old dialog with t11 off', async () => {
    setTweaks(['t11'], false)
    await openDialog()
    expect(radios()).toEqual(['Replace', 'Keep both', 'Rename', 'Skip'])
    expect(buttons()).toEqual(['Skip', 'Continue'])
    expect(nameInput()?.disabled).toBe(true)
  })
})
