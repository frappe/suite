import { afterEach, describe, expect, it, vi } from 'vitest'

import { bootRoots } from './roots'

afterEach(() => vi.unstubAllGlobals())

describe('bootRoots', () => {
  it('answers the locations the page loaded with', () => {
    vi.stubGlobal('drive_roots', {
      personal: { node: 'mine', title: 'My files' },
      organization: { node: 'org', title: 'Northwind' },
    })
    expect(bootRoots()).toEqual({
      personal: { node: 'mine', title: 'My files' },
      organization: { node: 'org', title: 'Northwind' },
    })
  })

  it('answers no organization when the caller has none', () => {
    const mine = { node: 'mine', title: 'My files' }
    vi.stubGlobal('drive_roots', { personal: mine, organization: null })
    expect(bootRoots()).toEqual({ personal: mine, organization: null })
  })

  it('answers nothing for a guest, a caller with no My files, or a malformed value', () => {
    expect(bootRoots()).toBeNull()
    vi.stubGlobal('drive_roots', null)
    expect(bootRoots()).toBeNull()
    vi.stubGlobal('drive_roots', { personal: { node: 'mine' } })
    expect(bootRoots()).toBeNull()
  })
})
