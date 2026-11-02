import { describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import SheetUpgradeBanner from './SheetUpgradeBanner.vue'

vi.mock('frappe-ui', () => ({
  Alert: {
    props: ['title', 'description'],
    setup: (props: { title: string; description: string }) => () =>
      h('div', `${props.title}: ${props.description}`),
  },
}))

const IMPORT = {
  ok: true,
  save: true,
  importedFrom: 'Forecast.xlsx',
  renamed: {},
  skipped: 0,
  unknown: [],
}

function banner(upgrade: Record<string, unknown>) {
  const root = document.createElement('div')
  const props = { upgrade: { ...IMPORT, ...upgrade }, readOnly: false, onClose: () => {} }
  createApp({ render: () => h(SheetUpgradeBanner, props) }).mount(root)
  return root.textContent ?? ''
}

describe('the notice after a sheet is converted', () => {
  it('says nothing about an import that came across cleanly', () => {
    expect(banner({})).toBe('')
  })

  it('heads an import with its file and lists every problem', () => {
    const notice = banner({
      unknown: [{ sheet: 'Q4', cell: 'B2' }],
      renamed: { 'a/b': 'a_b' },
      skipped: 3,
    })

    expect(notice).toContain('Imported from Forecast.xlsx')
    expect(notice).toContain('Q4!B2')
    expect(notice).toContain('a/b → a_b')
    expect(notice).toContain('3 cells')
    expect(notice).not.toContain('Before upgrade')
  })

  it('explains an import that could not be converted', () => {
    const notice = banner({ ok: false, save: false })

    expect(notice).toContain("Forecast.xlsx couldn't be converted to a sheet")
    expect(notice).toContain('read-only')
  })

  it('still points a sheet from the old editor at "Before upgrade"', () => {
    const notice = banner({ importedFrom: undefined })

    expect(notice).toContain('This sheet was upgraded to the new editor')
    expect(notice).toContain('Before upgrade')
  })
})
