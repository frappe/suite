import { describe, expect, it, vi } from 'vitest'

// The id counter lives at module level, so each test loads a fresh copy of
// the module: that is the state a page reload starts from.
async function freshEngine() {
  vi.resetModules()
  const { createCondFormatEngine } = await import('./cond-format.js')
  return createCondFormatEngine()
}

const saved = {
  S: [
    {
      id: 1,
      range: { r0: 1, c0: 1, r1: 3, c1: 1 },
      condition: { type: 'gt', value: '9' },
      format: { backgroundColor: '#fde68a' },
    },
  ],
}

const ids = (rules: readonly { id: number }[]) => rules.map((r) => r.id)

describe('CondFormatEngine ids', () => {
  it('a rule added after restore never reuses a restored id', async () => {
    const cf = await freshEngine()
    cf.restore(structuredClone(saved))
    const id = cf.addRule({ range: { r0: 5, c0: 0, r1: 5, c1: 0 } }, 'S')
    expect(id).not.toBe(1)
    expect(new Set(ids(cf.getRules('S'))).size).toBe(2)
  })

  it('pasting a ruled cell after restore gives the copy its own id (ISSUES #19)', async () => {
    const cf = await freshEngine()
    cf.restore(structuredClone(saved))
    cf.addRulesForRange({ r0: 2, c0: 1, r1: 2, c1: 1 }, { r0: 9, c0: 7, r1: 9, c1: 7 }, 'S')
    const rules = cf.getRules('S')
    expect(rules).toHaveLength(2)
    expect(new Set(ids(rules)).size).toBe(2)
  })

  it('removing the pasted copy keeps the original rule', async () => {
    const cf = await freshEngine()
    cf.restore(structuredClone(saved))
    cf.addRulesForRange({ r0: 2, c0: 1, r1: 2, c1: 1 }, { r0: 9, c0: 7, r1: 9, c1: 7 }, 'S')
    const copy = cf.getRules('S').find((r) => r.range.r0 === 9)!
    cf.removeRule(copy.id, 'S')
    expect(cf.getRules('S')).toEqual(saved.S)
  })

  it('a duplicated sheet gets rules with new ids', async () => {
    const cf = await freshEngine()
    cf.restore(structuredClone(saved))
    cf.duplicateSheet('S', 'S copy')
    const copies = cf.getRules('S copy')
    expect(copies).toHaveLength(1)
    expect(copies[0]!.id).not.toBe(1)
    expect(copies[0]!.range).toEqual(saved.S[0]!.range)
  })
})

// The painter hands rules the display string. IronCalc shows a typed 1,000
// as `1,000`, which parseFloat read as 1, so "greater than 100" missed it.
describe('CondFormatEngine on formatted numbers', () => {
  it('compares the number a cell shows', async () => {
    const cf = await freshEngine()
    cf.addRule(
      {
        range: { r0: 0, c0: 0, r1: 3, c1: 0 },
        condition: { type: 'gt', value: '100' },
        format: { backgroundColor: '#fde68a' },
      },
      'S',
    )
    expect(cf.getFormatOverride('A1', '1,000', 'S', () => '')).toMatchObject({
      backgroundColor: '#fde68a',
    })
    expect(cf.getFormatOverride('A2', '$250', 'S', () => '')).toMatchObject({
      backgroundColor: '#fde68a',
    })
    expect(cf.getFormatOverride('A3', '99', 'S', () => '')).toBeFalsy()
  })

  it('scales colours over formatted numbers', async () => {
    const cf = await freshEngine()
    const shown: Record<string, string> = { A1: '1,000', A2: '$0', A3: '50%' }
    cf.addRule(
      {
        kind: 'color-scale',
        range: { r0: 0, c0: 0, r1: 2, c1: 0 },
        scale: { variant: '2color' },
      } as never,
      'S',
    )
    const get = (id: string) => shown[id] ?? ''
    const top = cf.getFormatOverride('A1', '1,000', 'S', get)
    const bottom = cf.getFormatOverride('A2', '$0', 'S', get)
    expect(top?.backgroundColor).toBe('#0e7490')
    expect(bottom?.backgroundColor).toBe('#ffffff')
  })
})
