import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type App } from 'vue'

import BatchOutcome from './BatchOutcome.vue'
import type { BatchItem } from './batchResult'

vi.mock('frappe-ui', () => ({
  Alert: defineComponent({
    props: ['title', 'description', 'primaryAction'],
    setup(props) {
      return () =>
        h('div', { 'data-slot': 'alert' }, [
          h('p', props.title),
          props.description ? h('p', props.description) : null,
          props.primaryAction ? h('button', props.primaryAction.label) : null,
        ])
    },
  }),
  Dialog: defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h('div', { 'data-slot': 'dialog' }, slots.default?.()),
  }),
}))

const row = (name: string, title: string): BatchItem => ({
  name,
  title,
  kind: 'file',
  mime: 'application/pdf',
  content_doctype: null,
})

let app: App | null = null
function mount(props: Record<string, unknown>) {
  const root = document.createElement('div')
  app = createApp(BatchOutcome, props)
  app.mount(root)
  return root
}

afterEach(() => {
  app?.unmount()
  app = null
})

describe('Batch outcome', () => {
  const rows = [row('n1', 'Budget.pdf'), row('n2', 'Plan.pdf'), row('n3', 'Notes.pdf')]

  it('names a single failed item and says why, with no Details', () => {
    const root = mount({
      result: {
        ok: ['n2', 'n3'],
        failed: [{ node: 'n1', type: 'DriveForbidden', message: 'No access to Drive node n1' }],
      },
      verb: 'moved',
      rows,
    })
    const alert = root.querySelector('[data-slot="alert"]')!
    expect(alert.textContent).toContain('“Budget.pdf” could not be moved')
    expect(alert.textContent).toContain("You don't have permission.")
    expect(alert.textContent).not.toContain('Details')
    expect(root.textContent).not.toContain('n1')
  })

  it('counts several failures and lists each by title with a reason chosen by type', () => {
    const root = mount({
      result: {
        ok: ['n3'],
        failed: [
          { node: 'n1', type: 'DriveNotFound', message: 'Drive node n1 was not found' },
          { node: 'n2', type: 'SomethingElse', message: 'The server said no.' },
        ],
      },
      verb: 'moved to trash',
      rows,
    })
    const alert = root.querySelector('[data-slot="alert"]')!
    expect(alert.textContent).toContain('2 of 3 items could not be moved to Trash')
    expect(alert.textContent).toContain('Details')
    const dialog = root.querySelector('[data-slot="dialog"]')!
    expect(dialog.textContent).toContain('Budget.pdf')
    expect(dialog.textContent).toContain('It was moved or deleted by someone else.')
    expect(dialog.textContent).toContain('Plan.pdf')
    expect(dialog.textContent).toContain('The server said no.')
    expect(dialog.textContent).not.toContain('n1')
    expect(dialog.querySelectorAll('[data-slot="failure-icon"].file-icon-pdf')).toHaveLength(2)
  })
})
