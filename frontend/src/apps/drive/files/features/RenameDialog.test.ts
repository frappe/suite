import { createApp, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DriveNode } from '@/apps/drive/client/types'
import RenameDialog from './RenameDialog.vue'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../../../node_modules/frappe-ui/src/components/FormControl')),
}))

const report = { name: 'n1', title: 'Quarterly report.pdf', kind: 'file' } as DriveNode

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

async function openRename(node: DriveNode) {
  const root = document.createElement('div')
  document.body.append(root)
  const open = ref(true)
  const app = createApp({
    setup: () => () => h(RenameDialog, { node, open: open.value, 'onUpdate:open': (value: boolean) => (open.value = value) }),
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const input = await vi.waitFor(() => {
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input')
    expect(field && document.activeElement === field).toBe(true)
    return field!
  })
  return input
}

/** The text the field has selected. */
const selected = (input: HTMLInputElement) => input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)

/** Focus leaves the field and comes back, as when a closing menu refocuses its trigger and the dialog takes focus back. */
async function refocus(input: HTMLInputElement) {
  input.blur()
  input.focus()
  input.select()
  await Promise.resolve()
}

describe('Rename dialog', () => {
  it('selects the name without its extension, even when focus leaves and comes back before the user starts', async () => {
    const input = await openRename(report)
    expect(selected(input)).toBe('Quarterly report')

    // However late the menu hands focus back.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await refocus(input)
    expect(selected(input)).toBe('Quarterly report')
  })

  it('leaves the selection to the user once they type in the field', async () => {
    const input = await openRename(report)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))

    await refocus(input)
    expect(selected(input)).toBe('Quarterly report.pdf')
  })
})
