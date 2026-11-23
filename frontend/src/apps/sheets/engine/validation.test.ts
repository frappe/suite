import { beforeEach, describe, expect, it } from 'vitest'

import { checkRule, createValidationEngine } from './validation.js'

describe('ValidationEngine', () => {
  let v

  beforeEach(() => {
    v = createValidationEngine()
  })

  it('stores and retrieves a list rule', () => {
    v.set('A1', { type: 'list', options: ['Yes', 'No'] }, 'Sheet1')
    expect(v.get('A1', 'Sheet1')).toEqual({ type: 'list', options: ['Yes', 'No'] })
  })

  it('returns null for cell with no rule', () => {
    expect(v.get('Z99', 'Sheet1')).toBeNull()
  })

  it('clear removes a rule', () => {
    v.set('A1', { type: 'list', options: [] }, 'Sheet1')
    v.clear('A1', 'Sheet1')
    expect(v.get('A1', 'Sheet1')).toBeNull()
  })

  describe('validate — list', () => {
    beforeEach(() => v.set('A1', { type: 'list', options: ['Yes', 'No'] }, 'Sheet1'))

    it('passes for a valid option', () => {
      expect(v.validate('A1', 'Yes', 'Sheet1').valid).toBe(true)
    })

    it('fails for an invalid option', () => {
      const r = v.validate('A1', 'Maybe', 'Sheet1')
      expect(r.valid).toBe(false)
      expect(r.message).toMatch(/Yes.*No/)
    })
  })

  describe('validate — number', () => {
    beforeEach(() => v.set('B1', { type: 'number', min: 1, max: 10 }, 'Sheet1'))

    it('passes for a number in range', () => {
      expect(v.validate('B1', '5', 'Sheet1').valid).toBe(true)
    })

    it('fails for non-numeric value', () => {
      expect(v.validate('B1', 'abc', 'Sheet1').valid).toBe(false)
    })

    it('fails below min', () => {
      expect(v.validate('B1', '0', 'Sheet1').valid).toBe(false)
    })

    it('fails above max', () => {
      expect(v.validate('B1', '11', 'Sheet1').valid).toBe(false)
    })
  })

  describe('validate — checkbox', () => {
    beforeEach(() => v.set('C1', { type: 'checkbox' }, 'Sheet1'))

    it('passes for TRUE / FALSE, case-insensitively', () => {
      expect(v.validate('C1', 'TRUE', 'Sheet1').valid).toBe(true)
      expect(v.validate('C1', 'false', 'Sheet1').valid).toBe(true)
    })

    it('fails for any other value', () => {
      const r = v.validate('C1', 'yes', 'Sheet1')
      expect(r.valid).toBe(false)
      expect(r.message).toMatch(/TRUE.*FALSE/)
    })

    it('shifts and round-trips like any rule', () => {
      v.insertRow(0, 'Sheet1')
      expect(v.get('C2', 'Sheet1')).toEqual({ type: 'checkbox' })
    })
  })

  it('passes all values when no rule exists', () => {
    expect(v.validate('Z9', 'anything', 'Sheet1').valid).toBe(true)
  })

  it('insertRow shifts rules down', () => {
    v.set('A2', { type: 'list', options: ['x'] }, 'Sheet1')
    v.insertRow(1, 'Sheet1')
    expect(v.get('A3', 'Sheet1')).toBeTruthy()
    expect(v.get('A2', 'Sheet1')).toBeNull()
  })

  it('snapshot and restore round-trips', () => {
    v.set('A1', { type: 'list', options: ['a', 'b'] }, 'Sheet1')
    const snap = v.snapshot()
    const v2 = createValidationEngine()
    v2.restore(snap)
    expect(v2.get('A1', 'Sheet1')).toEqual({ type: 'list', options: ['a', 'b'] })
  })
})

describe('checkRule — severity', () => {
  const rule = { type: 'number', operator: 'between', min: 1, max: 10 }

  it('defaults failing rules to reject', () => {
    expect(checkRule(rule, 50).severity).toBe('reject')
  })
  it('reports warn when the rule opts into it', () => {
    const warnRule = { ...rule, severity: 'warn' }
    const res = checkRule(warnRule, 50)
    expect(res.valid).toBe(false)
    expect(res.severity).toBe('warn')
  })
  it('leaves severity undefined for a passing value', () => {
    expect(checkRule({ ...rule, severity: 'warn' }, 5).severity).toBeUndefined()
  })
})
