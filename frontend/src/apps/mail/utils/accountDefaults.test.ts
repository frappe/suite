import { afterEach, describe, expect, it, vi } from 'vitest'

import { accountDefaults } from './accountDefaults'

afterEach(() => vi.restoreAllMocks())
const options = {
  locales: [{ value: 'en-US' }, { value: 'fr-FR' }],
  time_zones: [{ value: 'Europe/Paris' }],
}
describe('account creation defaults', () => {
  it('selects the first supported browser locale and zone', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['xx-XX', 'fr-FR', 'en-US'])
    const resolved = Intl.DateTimeFormat().resolvedOptions()
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...resolved,
      timeZone: 'Europe/Paris',
    })
    expect(accountDefaults(options)).toEqual({ locale: 'fr-FR', time_zone: 'Europe/Paris' })
  })
  it('leaves unsupported or unavailable preferences for the server', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['invalid'])
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('Unavailable')
    })
    expect(accountDefaults(options)).toEqual({ locale: null, time_zone: null })
    expect(accountDefaults()).toEqual({ locale: null, time_zone: null })
  })
})
