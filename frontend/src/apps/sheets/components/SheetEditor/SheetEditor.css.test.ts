import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, 'SheetEditor.css'), 'utf8')

/** The declarations of a rule, by its exact selector. */
function rule(selector: string): string {
  const at = css.indexOf(`
${selector} {`)
  expect(at, selector).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('the bars around the grid', () => {
  it('draws the line under the formula bar in the lightest outline', () => {
    expect(rule('.sn-root')).toContain('--sn-bar-line: var(--outline-gray-1)')
  })

  it('draws the line above the tabs in the lightest outline', () => {
    const tabs = readFileSync(resolve(__dirname, 'SheetTabsBar.vue'), 'utf8')
    const bottom = tabs.slice(tabs.indexOf('.sn-bottom {'))
    expect(bottom.slice(0, bottom.indexOf('}'))).toContain(
      'border-top: 1px solid var(--outline-gray-1)',
    )
  })
})

describe('the formula bar', () => {
  it('has no line between it and the toolbar', () => {
    const toolbar = readFileSync(resolve(__dirname, 'SheetToolbar.vue'), 'utf8')
    expect(toolbar.slice(toolbar.indexOf('.sn-toolbar {'))).not.toMatch(/^\s*border-bottom:/m)
  })

  it('is 36px tall', () => {
    expect(rule('.sn-formula-row')).toContain('height: 36px')
  })

  // The forms plugin draws a blue 1px box-shadow on every focused text input.
  it('shows only the caret while the value field is focused', () => {
    expect(rule('.sn-formula-input:focus')).toContain('box-shadow: none')
  })

  it('draws no outline around the focused name box', () => {
    expect(rule('.sn-cell-ref:focus')).toContain('box-shadow: none')
    expect(rule('.sn-cell-ref:focus')).not.toContain('border-color')
  })
})
