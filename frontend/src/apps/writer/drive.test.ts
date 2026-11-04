import { beforeEach, describe, expect, it, vi } from 'vitest'

import { transport } from '@/platform/transport'

import { searchUsers } from './drive'

vi.mock('@/platform/transport', () => ({ transport: { request: vi.fn() } }))

const user = (name: string, full_name: string | null) => ({
  kind: 'user' as const,
  name,
  email: name,
  full_name,
  user_image: null,
})

const page = {
  rows: [user('asha@x.test', 'Asha '), { kind: 'group', name: 'Design', member_count: 2 }],
  next_cursor: '20',
}

describe('mention search', () => {
  beforeEach(() => vi.mocked(transport.request).mockReset())

  it('sends the typed text as the query and fetches one page of users only', async () => {
    vi.mocked(transport.request).mockResolvedValue(page)

    const found = await searchUsers(' as ')

    expect(found.map((u) => [u.name, u.value, u.label])).toEqual([
      ['asha@x.test', 'asha@x.test', 'Asha'],
    ])
    expect(vi.mocked(transport.request).mock.calls.map(([, input]) => input)).toEqual([{ q: 'as' }])
  })

  it('asks for the first page of everyone when nothing is typed', async () => {
    vi.mocked(transport.request).mockResolvedValue({
      rows: [user('ben@x.test', null)],
      next_cursor: null,
    })

    const found = await searchUsers('')

    expect(found[0]?.label).toBe('ben@x.test')
    expect(vi.mocked(transport.request).mock.calls.map(([, input]) => input)).toEqual([{}])
  })
})
