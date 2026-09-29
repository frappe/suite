import { describe, expect, it } from 'vitest'
import { api } from './generated'

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
    expect(api.webdav_get.validateOutput).toBeDefined()
    for (const answer of [{}, { globally_enabled: false, is_admin: true }, connection]) {
      expect(() => api.webdav_get.validateOutput?.(answer)).not.toThrow()
    }
  })

  it('refuses an answer that carries a key the route never sends', () => {
    for (const answer of [
      { api_secret: 'secret' },
      { globally_enabled: false, is_admin: true, api_secret: 'secret' },
      { ...connection, api_secret: 'secret' },
    ]) {
      expect(() => api.webdav_get.validateOutput?.(answer)).toThrow()
    }
  })
})
