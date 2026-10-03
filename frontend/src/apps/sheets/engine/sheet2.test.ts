// Reactivity + dependency-graph gate for sheet2.js. Correct behaviour here is
// spec-defined (a dependent must reflect its precedent's current value; a
// reference to a deleted sheet must become #REF!), so no oracle is needed.

import { describe, expect, it } from 'vitest'

import { createSheet2 } from './sheet2.js'

const num = (v) => Number(v)

describe('reactivity — the findings that broke the old engine', () => {
  it('scalar dependency recalcs', () => {
    const s = createSheet2()
    s.setCell('A1', '5')
    s.setCell('B1', '=A1+1')
    expect(num(s.getDisplay('B1'))).toBe(6)
    s.setCell('A1', '10')
    expect(num(s.getDisplay('B1'))).toBe(11)
  })

  it('range aggregate recalcs on member edit', () => {
    const s = createSheet2()
    s.setCell('A1', '1')
    s.setCell('A2', '2')
    s.setCell('A3', '3')
    s.setCell('B1', '=SUM(A1:A3)')
    expect(num(s.getDisplay('B1'))).toBe(6)
    s.setCell('A2', '20')
    expect(num(s.getDisplay('B1'))).toBe(24)
  })

  it('named range recalcs when its source cell changes', () => {
    const s = createSheet2()
    s.setCell('A1', '3')
    s.defineName('REV', { sheet: 'Sheet1', start: 'A1', end: 'A1' })
    s.setCell('C1', '=REV*2')
    expect(num(s.getDisplay('C1'))).toBe(6)
    s.setCell('A1', '10')
    expect(num(s.getDisplay('C1'))).toBe(20)
  })

  it('named range rebind updates dependents', () => {
    const s = createSheet2()
    s.setCell('A1', '3')
    s.setCell('A2', '100')
    s.defineName('REV', { sheet: 'Sheet1', start: 'A1', end: 'A1' })
    s.setCell('C1', '=REV*2')
    expect(num(s.getDisplay('C1'))).toBe(6)
    s.defineName('REV', { sheet: 'Sheet1', start: 'A2', end: 'A2' })
    expect(num(s.getDisplay('C1'))).toBe(200)
  })

  it('cross-sheet formula recalcs on remote edit', () => {
    const s = createSheet2()
    s.addSheet('Sheet2')
    s.setCell('A1', '5', 'Sheet2')
    s.setCell('B1', '=Sheet2!A1+1', 'Sheet1')
    expect(num(s.getDisplay('B1', 'Sheet1'))).toBe(6)
    s.setCell('A1', '9', 'Sheet2')
    expect(num(s.getDisplay('B1', 'Sheet1'))).toBe(10)
  })

  it('deleting the referenced sheet yields #REF!', () => {
    const s = createSheet2()
    s.addSheet('Sheet2')
    s.setCell('A1', '5', 'Sheet2')
    s.setCell('B1', '=Sheet2!A1+1', 'Sheet1')
    expect(num(s.getDisplay('B1', 'Sheet1'))).toBe(6)
    s.deleteSheet('Sheet2')
    expect(s.getDisplay('B1', 'Sheet1')).toMatch(/#REF/)
  })

  it('whole-column aggregate recalcs on member edit', () => {
    const s = createSheet2()
    s.addSheet('Data')
    s.setCell('A1', '1', 'Data')
    s.setCell('A2', '2', 'Data')
    s.setCell('A3', '3', 'Data')
    s.setCell('B1', '=SUM(Data!A:A)', 'Sheet1')
    expect(num(s.getDisplay('B1', 'Sheet1'))).toBe(6)
    s.setCell('A2', '20', 'Data')
    expect(num(s.getDisplay('B1', 'Sheet1'))).toBe(24)
  })

  it('volatility propagates to dependents (RAND)', () => {
    const s = createSheet2()
    s.setCell('A1', '=RAND()')
    s.setCell('B1', '=A1')
    const r1 = s.getDisplay('B1'),
      r2 = s.getDisplay('B1'),
      r3 = s.getDisplay('B1')
    expect(r1 === r2 && r2 === r3).toBe(false)
  })
})

describe('dependency graph — adversarial robustness', () => {
  it('transitive chain of 5 recalcs from the head', () => {
    const s = createSheet2()
    s.setCell('A1', '1')
    for (let i = 2; i <= 5; i++) s.setCell('A' + i, `=A${i - 1}+1`)
    expect(num(s.getDisplay('A5'))).toBe(5)
    s.setCell('A1', '10')
    expect(num(s.getDisplay('A5'))).toBe(14)
  })

  it('deep chain of 5000 evaluates without stack overflow', () => {
    const s = createSheet2()
    s.setCell('A1', '1')
    for (let i = 2; i <= 5000; i++) s.setCell('A' + i, `=A${i - 1}+1`)
    expect(s.getDisplay('A5000')).not.toMatch(/#/)
    expect(num(s.getDisplay('A5000'))).toBe(5000)
  })

  it('direct and indirect cycles resolve to an error, no hang', () => {
    const s = createSheet2()
    s.setCell('A1', '=B1')
    s.setCell('B1', '=A1')
    expect(s.getDisplay('A1')).toMatch(/#(CIRCULAR|REF|ERROR)/)
    const s2 = createSheet2()
    s2.setCell('A1', '=B1+1')
    s2.setCell('B1', '=C1+1')
    s2.setCell('C1', '=A1+1')
    expect(s2.getDisplay('A1')).toMatch(/#(CIRCULAR|REF|ERROR)/)
  })

  it('diamond dependency recalcs through both paths', () => {
    const s = createSheet2()
    s.setCell('A1', '3')
    s.setCell('B1', '=A1+1')
    s.setCell('C1', '=A1*2')
    s.setCell('D1', '=B1+C1')
    expect(num(s.getDisplay('D1'))).toBe(10)
    s.setCell('A1', '5')
    expect(num(s.getDisplay('D1'))).toBe(16)
  })

  it('overwriting a formula with a constant tears down its dependency', () => {
    const s = createSheet2()
    s.setCell('A1', '5')
    s.setCell('B1', '=A1+1')
    s.setCell('B1', '99')
    s.setCell('A1', '1000')
    expect(num(s.getDisplay('B1'))).toBe(99)
  })

  it('re-pointing a formula updates its dependency set', () => {
    const s = createSheet2()
    s.setCell('A1', '1')
    s.setCell('A2', '2')
    s.setCell('C1', '=A1')
    s.setCell('C1', '=A2')
    s.setCell('A1', '999')
    expect(num(s.getDisplay('C1'))).toBe(2)
    s.setCell('A2', '7')
    expect(num(s.getDisplay('C1'))).toBe(7)
  })

  it('range dependency: inside edits recalc, outside edits are inert', () => {
    const s = createSheet2()
    s.setCell('A1', '1')
    s.setCell('A2', '2')
    s.setCell('A3', '3')
    s.setCell('B1', '=SUM(A1:A3)')
    s.setCell('A5', '1000')
    expect(num(s.getDisplay('B1'))).toBe(6)
    s.setCell('A3', '30')
    expect(num(s.getDisplay('B1'))).toBe(33)
  })

  it('undefineName invalidates dependents', () => {
    const s = createSheet2()
    s.setCell('A1', '3')
    s.defineName('REV', { sheet: 'Sheet1', start: 'A1', end: 'A1' })
    s.setCell('C1', '=REV*2')
    expect(num(s.getDisplay('C1'))).toBe(6)
    s.undefineName('REV')
    expect(s.getDisplay('C1')).toMatch(/#NAME/)
  })

  it('re-adding a deleted sheet clears #REF!', () => {
    const s = createSheet2()
    s.addSheet('Sheet2')
    s.setCell('A1', '5', 'Sheet2')
    s.setCell('B1', '=Sheet2!A1+1', 'Sheet1')
    s.deleteSheet('Sheet2')
    expect(s.getDisplay('B1', 'Sheet1')).toMatch(/#REF/)
    s.addSheet('Sheet2')
    s.setCell('A1', '7', 'Sheet2')
    expect(num(s.getDisplay('B1', 'Sheet1'))).toBe(8)
  })
})
