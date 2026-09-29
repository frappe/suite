import { afterEach, describe, expect, it } from 'vitest'

import { readBootFlag } from '@/platform/boot'

describe('boot flags', () => {
  afterEach(() => {
    delete window.suite_flip_shell
  })

  it('reads a flag the boot leaves out as off', () => {
    expect(readBootFlag('suite_flip_shell')).toBe(false)
  })

  it('follows the value the boot sends', () => {
    window.suite_flip_shell = true
    expect(readBootFlag('suite_flip_shell')).toBe(true)
    window.suite_flip_shell = false
    expect(readBootFlag('suite_flip_shell')).toBe(false)
  })
})
