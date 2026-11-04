import { describe, expect, it, vi } from 'vitest'

import { createPeople } from './people'

vi.mock('@/api', () => ({ api: {}, client: {} }))

describe('people', () => {
  it('names a person by user id until the lookup answers, looking each up once', async () => {
    const search = vi.fn(async () => ({ fullName: 'Ann Lee', image: '/a.png' }))
    const { person, version } = createPeople(search)
    expect(person('ann@x')).toEqual({ fullName: 'ann@x', image: '' })
    person('ann@x')
    await vi.waitFor(() => expect(version.value).toBe(1))
    expect(person('ann@x')).toEqual({ fullName: 'Ann Lee', image: '/a.png' })
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('keeps the user id when the lookup fails', async () => {
    const search = vi.fn(async () => {
      throw new Error('offline')
    })
    const { person } = createPeople(search)
    person('bob@x')
    await Promise.resolve()
    expect(person('bob@x').fullName).toBe('bob@x')
  })
})
