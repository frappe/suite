import { describe, expect, it } from 'vitest'

import { operationRootUsage as usage, operationWebdavGet as webdav } from './validators'

const connection = {
  globally_enabled: true,
  is_admin: false,
  server_url: 'https://example.test/dav/',
  username: 'a@example.com',
  enabled_for_user: true,
  two_factor_blocked: false,
  api_key: 'key',
}

describe('GET /webdav output contract', () => {
  it('accepts each of the three answers the route gives', () => {
    expect(webdav.validateOutput).toBeDefined()
    for (const answer of [{}, { globally_enabled: false, is_admin: true }, connection]) {
      expect(() => webdav.validateOutput?.(answer)).not.toThrow()
    }
  })

  it('refuses an answer that carries a key the route never sends', () => {
    for (const answer of [
      { api_secret: 'secret' },
      { globally_enabled: false, is_admin: true, api_secret: 'secret' },
      { ...connection, api_secret: 'secret' },
    ]) {
      expect(() => webdav.validateOutput?.(answer)).toThrow()
    }
  })
})

describe('GET /roots/<id>/usage output contract', () => {
  const totals = { used_bytes: 1200, reserved_bytes: 0, quota_bytes: null, effective_quota: 0 }

  it('accepts the totals alone and the totals with the breakdown', () => {
    const breakdown = {
      ...totals,
      by_type: [{ type: 'PDF', bytes: 900 }],
      largest: [
        {
          node: 'n1',
          title: 'a.pdf',
          size: 900,
          mime: 'application/pdf',
          kind: 'file',
          type: 'PDF',
        },
      ],
    }
    for (const answer of [totals, breakdown]) {
      expect(() => usage.validateOutput?.(answer)).not.toThrow()
    }
  })

  it('refuses a largest entry that is a folder', () => {
    const folder = { node: 'n1', title: 'F', size: 0, mime: null, kind: 'folder', type: 'Folder' }
    expect(() => usage.validateOutput?.({ ...totals, by_type: [], largest: [folder] })).toThrow()
  })

  it('sends only the breakdown expansion', () => {
    expect(() => usage.validateInput?.({ root: 'r1', expand: 'breakdown' })).not.toThrow()
    expect(() => usage.validateInput?.({ root: 'r1', expand: 'access' })).toThrow()
  })
})
