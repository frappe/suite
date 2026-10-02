import { describe, expect, it } from 'vitest'
import { locationOf, locationTitle } from './locations'

const discovered = { personal: { node: 'p-root', title: 'Administrator' }, organization: { node: 'o-root', title: 'Frappe' } }

describe('locations', () => {
  it('names the caller’s own roots by their place, and other nodes by title', () => {
    expect(locationTitle({ name: 'p-root', title: 'Administrator' }, discovered)).toBe('My files')
    expect(locationTitle({ name: 'o-root', title: 'Frappe' }, discovered)).toBe('Organization files')
    expect(locationTitle({ name: 'other-root', title: 'Jane Doe' }, discovered)).toBe('Jane Doe')
    expect(locationTitle({ name: 'p-root', title: 'Administrator' }, null)).toBe('Administrator')
  })

  it('places a folder by its root', () => {
    expect(locationOf({ root: 'p-root' }, discovered)).toBe('personal')
    expect(locationOf({ root: 'o-root' }, discovered)).toBe('organization')
    expect(locationOf({ root: 'someone-else' }, discovered)).toBe('shared')
  })
})
