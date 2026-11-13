import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sfc = readFileSync(resolve(__dirname, 'SheetsSurface.vue'), 'utf8')
const css = sfc.slice(sfc.indexOf('<style'))

/** Every selector in the header's styles that gives a button the "on" fill. */
function onFillSelectors(): string[] {
  const out: string[] = []
  for (const [, selectors = '', body = ''] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!body.includes('--sn-bar-on')) continue
    out.push(...selectors.split(',').map((s) => s.trim()))
  }
  return out
}

describe('the Sheets header', () => {
  // The shared header's Star sets aria-pressed while the file is starred.
  // Writer draws no fill behind it, so a starred sheet must not either.
  it('keeps the "on" fill off the Star button', () => {
    const pressed = onFillSelectors().filter((s) => s.includes('aria-pressed'))
    expect(pressed.length).toBeGreaterThan(0)
    for (const s of pressed) expect(s).toContain('[data-panel]')
  })

  it('keeps the "on" fill on an open menu', () => {
    expect(onFillSelectors()).toContain(".sheets-header :deep(button[data-state='open'])")
  })
})
