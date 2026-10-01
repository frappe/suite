import { describe, expect, it } from 'vitest'

import { devBootFlags } from '@/platform/boot/devFlips'

describe('dev boot flags', () => {
  it('turns a flip on for the values bench set-config writes, in any case', () => {
    for (const value of [1, '1', true, 'true', ' TRUE ', 'True']) {
      expect(devBootFlags({}, { suite_flip_shell: value }).suite_flip_shell).toBe(true)
    }
  })

  it('keeps a flip off for any other value', () => {
    for (const value of [0, '0', false, 'false', '', 'yes', 2, null]) {
      expect(devBootFlags({}, { suite_flip_shell: value }).suite_flip_shell).toBe(false)
    }
  })

  it('reads a missing key as off', () => {
    expect(devBootFlags({}, {})).toEqual({ suite_flip_shell: false, suite_flip_files: false })
  })

  it('lets the site config override the common config', () => {
    const common = { suite_flip_shell: 1, suite_flip_files: 1 }
    expect(devBootFlags(common, { suite_flip_files: 0 })).toEqual({
      suite_flip_shell: true,
      suite_flip_files: false,
    })
    expect(devBootFlags({ suite_flip_shell: 0 }, { suite_flip_shell: 'true' }).suite_flip_shell).toBe(true)
  })
})
