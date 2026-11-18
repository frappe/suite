import { beforeEach, describe, expect, it } from 'vitest'

import { useWorkspace } from '@/platform/workspace'

import {
  locationLabel,
  locationOf,
  locationTitle,
  openedFromLink,
  trashLocation,
} from './locations'

const discovered = {
  personal: { node: 'p-root', title: 'Administrator' },
  organization: { node: 'o-root', title: 'Frappe' },
}

const nameWorkspace = (workspace_name: string) =>
  useWorkspace().setWorkspace({ workspace_name, workspace_logo: '' })

beforeEach(() => nameWorkspace(''))

describe('locations', () => {
  it('counts a folder as opened from a link only when a link, not a share, opens it', () => {
    const viaLink = {
      root: 'other-root',
      access: { role: 10, via_link: '$LINK:abc', own_role: 0 },
    }
    const shared = { root: 'other-root', access: { role: 10, via_link: null, own_role: 10 } }
    // Shared with them as Viewer, and opened through an edit link: it is in Shared with me.
    const sharedAndLinked = {
      root: 'other-root',
      access: { role: 30, via_link: '$LINK:abc', own_role: 10 },
    }
    const own = { root: 'p-root', access: { role: 50, via_link: '$LINK:abc', own_role: 50 } }

    expect(openedFromLink(viaLink, discovered)).toBe(true)
    expect(openedFromLink(shared, discovered)).toBe(false)
    expect(openedFromLink(sharedAndLinked, discovered)).toBe(false)
    expect(openedFromLink(own, discovered)).toBe(false)
  })

  it('names the caller’s own roots by their place, and other nodes by title', () => {
    expect(locationTitle({ name: 'p-root', title: 'Administrator' }, discovered)).toBe('My files')
    expect(locationTitle({ name: 'o-root', title: 'Frappe' }, discovered)).toBe(
      'Organization files',
    )
    expect(locationTitle({ name: 'other-root', title: 'Jane Doe' }, discovered)).toBe('Jane Doe')
    expect(locationTitle({ name: 'p-root', title: 'Administrator' }, null)).toBe('Administrator')
  })

  it('names the organization root after the company the site was set up for', () => {
    nameWorkspace('Northwind Labs')
    expect(locationLabel('organization')).toBe('Northwind Labs files')
    expect(locationTitle({ name: 'o-root', title: 'Frappe' }, discovered)).toBe(
      'Northwind Labs files',
    )
    expect(locationLabel('personal')).toBe('My files')
  })

  it('follows a rename at once', () => {
    nameWorkspace('Northwind Labs')
    expect(locationLabel('organization')).toBe('Northwind Labs files')

    nameWorkspace('Acme')

    expect(locationLabel('organization')).toBe('Acme files')
  })

  it('places a folder by its root', () => {
    expect(locationOf({ root: 'p-root' }, discovered)).toBe('personal')
    expect(locationOf({ root: 'o-root' }, discovered)).toBe('organization')
    expect(locationOf({ root: 'someone-else' }, discovered)).toBe('shared')
  })

  it('sends organization files to the organization Trash tab, and the rest to the personal one', () => {
    expect(trashLocation({ root: 'o-root' }, discovered)).toEqual({
      path: '/drive/trash',
      query: { root: 'organization' },
    })
    expect(trashLocation({ root: 'p-root' }, discovered)).toEqual({
      path: '/drive/trash',
      query: {},
    })
    expect(trashLocation({ root: 'o-root' }, null)).toEqual({ path: '/drive/trash', query: {} })
  })
})
