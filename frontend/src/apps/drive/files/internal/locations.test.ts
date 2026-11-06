import { afterEach, describe, expect, it, vi } from 'vitest'

import { setTweaks } from '@/platform/tweaks'

const discovered = {
  personal: { node: 'p-root', title: 'Administrator' },
  organization: { node: 'o-root', title: 'Frappe' },
}

/** The module reads the booted workspace name once, so each case loads a fresh copy. */
async function load(workspaceName: string) {
  vi.resetModules()
  window.suite_workspace_name = workspaceName
  return await import('./locations')
}

afterEach(() => {
  delete window.suite_workspace_name
  setTweaks(['t41-company-files'], true)
})

describe('locations', () => {
  it('names the caller’s own roots by their place, and other nodes by title', async () => {
    const { locationTitle } = await load('')
    expect(locationTitle({ name: 'p-root', title: 'Administrator' }, discovered)).toBe('My files')
    expect(locationTitle({ name: 'o-root', title: 'Frappe' }, discovered)).toBe(
      'Organization files',
    )
    expect(locationTitle({ name: 'other-root', title: 'Jane Doe' }, discovered)).toBe('Jane Doe')
    expect(locationTitle({ name: 'p-root', title: 'Administrator' }, null)).toBe('Administrator')
  })

  it('names the organization root after the company the site was set up for', async () => {
    const { locationLabel, locationTitle } = await load('Northwind Labs')
    expect(locationLabel('organization')).toBe('Northwind Labs files')
    expect(locationTitle({ name: 'o-root', title: 'Frappe' }, discovered)).toBe(
      'Northwind Labs files',
    )
    expect(locationLabel('personal')).toBe('My files')
  })

  it('keeps "Organization files" with the switch off', async () => {
    setTweaks(['t41-company-files'], false)
    const { locationLabel } = await load('Northwind Labs')
    expect(locationLabel('organization')).toBe('Organization files')
  })

  it('places a folder by its root', async () => {
    const { locationOf } = await load('')
    expect(locationOf({ root: 'p-root' }, discovered)).toBe('personal')
    expect(locationOf({ root: 'o-root' }, discovered)).toBe('organization')
    expect(locationOf({ root: 'someone-else' }, discovered)).toBe('shared')
  })

  it('sends organization files to the organization Trash tab, and the rest to the personal one', async () => {
    const { trashLocation } = await load('')
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
