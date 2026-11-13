import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { dialog } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, type App } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { requireTestElement } from '@/platform/testing/dom'

import SlidesVersionsPanel from './SlidesVersionsPanel.vue'

vi.mock('frappe-ui', async () => {
  const { defineComponent: define, h: render } = await import('vue')
  const emptyComponent = { render: () => null }
  return {
    Badge: emptyComponent,
    Skeleton: emptyComponent,
    Button: define({
      props: { label: String },
      emits: ['click'],
      setup:
        (props, { emit }) =>
        () =>
          render('button', { onClick: () => emit('click') }, props.label),
    }),
    dialog: { prompt: vi.fn(), confirm: vi.fn() },
    toast: { success: vi.fn(), error: vi.fn() },
  }
})

let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  vi.mocked(dialog.prompt).mockReset()
})

// The panel with "Save version" pressed: what its dialog runs on Save, and the versions it creates
function savingVersion(flush: () => Promise<void>) {
  const create = vi.fn(async () => {})
  const session = fromPartial<DocumentSession>({
    versions: { list: async () => ({ rows: [], next_cursor: null }), create },
  })
  const root = document.createElement('div')
  app = createApp({
    render: () =>
      h(SlidesVersionsPanel, { session, writable: true, flush, restore: async () => {} }),
  })
  app.mount(root)
  const button = Array.from(root.querySelectorAll('button')).find(
    (element) => element.textContent === 'Save version',
  )
  requireTestElement(button, HTMLElement).click()
  const [asked] = fromAny<
    [{ onConfirm: (ctx: { values: { label: string } }) => Promise<void> }],
    unknown
  >(vi.mocked(dialog.prompt).mock.lastCall)
  return { save: () => asked.onConfirm({ values: { label: 'Draft one' } }), create }
}

describe('naming a version', () => {
  it('takes no version when the edits are not saved, and gives the reason to the dialog', async () => {
    const reason = 'No version was taken: your changes could not be saved.'
    const { save, create } = savingVersion(async () => {
      throw new Error(reason)
    })

    await expect(save()).rejects.toThrow(reason)
    expect(create).not.toHaveBeenCalled()
  })

  it('takes the named version once the edits are saved', async () => {
    const { save, create } = savingVersion(async () => {})

    await save()

    expect(create).toHaveBeenCalledWith('named', 'Draft one')
  })
})
