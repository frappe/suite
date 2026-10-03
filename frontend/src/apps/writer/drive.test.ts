import { beforeEach, describe, expect, it, vi } from 'vitest'

import { transport } from '@/platform/transport'

import { listUsers } from './drive'

vi.mock('@/platform/transport', () => ({ transport: { request: vi.fn() } }))

const user = (name: string, full_name: string | null) => ({
  kind: 'user' as const,
  name,
  email: name,
  full_name,
  user_image: null,
})

describe('mention users', () => {
  beforeEach(() => vi.mocked(transport.request).mockReset())

  it('lists the users on every page of the people route and leaves out groups', async () => {
    vi.mocked(transport.request)
      .mockResolvedValueOnce({
        rows: [user('asha@x.test', 'Asha '), { kind: 'group', name: 'Design', member_count: 2 }],
        next_cursor: '20',
      })
      .mockResolvedValueOnce({ rows: [user('ben@x.test', null)], next_cursor: null })

    const users = await listUsers()

    expect(users.map((u) => [u.name, u.value, u.label])).toEqual([
      ['asha@x.test', 'asha@x.test', 'Asha'],
      ['ben@x.test', 'ben@x.test', 'ben@x.test'],
    ])
    expect(vi.mocked(transport.request).mock.calls.map(([, input]) => input)).toEqual([
      {},
      { cursor: '20' },
    ])
  })
})
