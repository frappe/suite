import { describe, expect, it } from 'vitest'

import { linkAccess } from './linkAccess'

const LINK = '$LINK:L000000000000000000001'
const through = (role: number, via_link: string | null) => ({ access: { role, via_link } })

describe('what a node reached through a link offers', () => {
  it('offers everything when the caller holds their own grant', () => {
    expect(linkAccess(through(40, null), true)).toEqual({
      star: true,
      visit: true,
      documentKinds: true,
    })
    expect(linkAccess(through(30, null), true)).toEqual({
      star: true,
      visit: true,
      documentKinds: true,
    })
  })

  it('hides Star and records no visit when only the link gives access', () => {
    expect(linkAccess(through(40, LINK), true)).toEqual({
      star: false,
      visit: false,
      documentKinds: true,
    })
  })

  it('hides the document kinds below EDIT through a link, for a guest or a signed-in user', () => {
    expect(linkAccess(through(30, LINK), true).documentKinds).toBe(false)
    expect(linkAccess(through(30, LINK), false)).toEqual({
      star: false,
      visit: false,
      documentKinds: false,
    })
  })

  it('gives a guest no Star and no visit, even on a public node', () => {
    expect(linkAccess(through(10, null), false)).toEqual({
      star: false,
      visit: false,
      documentKinds: true,
    })
  })
})
