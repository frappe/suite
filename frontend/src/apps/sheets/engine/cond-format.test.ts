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
