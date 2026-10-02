import { describe, expect, it } from 'vitest'

import { storageMeter } from './storageMeter'

const GB = 1_000_000_000

describe('storage meter', () => {
  it('reads use against the quota', () => {
    expect(storageMeter({ used_bytes: 2.4 * GB, effective_quota: 10 * GB })).toEqual({
      label: '2.4 GB of 10.0 GB used',
      percent: 24,
      level: 'ok',
    })
  })

  it('warns from 90% and turns full at the quota, without overfilling the bar', () => {
    expect(storageMeter({ used_bytes: 8.9 * GB, effective_quota: 10 * GB }).level).toBe('ok')
    expect(storageMeter({ used_bytes: 9 * GB, effective_quota: 10 * GB }).level).toBe('near')
    expect(storageMeter({ used_bytes: 10 * GB, effective_quota: 10 * GB }).level).toBe('full')
    expect(storageMeter({ used_bytes: 12 * GB, effective_quota: 10 * GB })).toMatchObject({ percent: 100, level: 'full' })
  })

  it('shows a sliver for a little use and nothing for none', () => {
    expect(storageMeter({ used_bytes: 5_000_000, effective_quota: 10 * GB }).percent).toBe(1)
    expect(storageMeter({ used_bytes: 0, effective_quota: 10 * GB }).percent).toBe(0)
  })

  it('has no bar when the root has no quota', () => {
    expect(storageMeter({ used_bytes: 2.4 * GB, effective_quota: 0 })).toEqual({
      label: '2.4 GB used',
      percent: null,
      level: 'ok',
    })
  })
})
