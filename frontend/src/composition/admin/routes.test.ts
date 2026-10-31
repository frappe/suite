import { describe, expect, it, vi } from 'vitest'

import { routes } from './routes'

vi.mock('@/apps/mail', () => ({
  loadMailAdminRoutes: async () => ({
    routes: [
      {
        path: 'mail',
        meta: { area: 'admin' },
        children: [
          { name: 'mail-domains' },
          { name: 'mail-groups' },
          { name: 'mail-dmarc-reports' },
          { name: 'mail-tls-reports' },
        ],
      },
    ],
  }),
}))

describe('Suite Admin routes', () => {
  it('owns users, storage and business settings without old dashboard URLs', () => {
    const children = routes[0].children!
    expect(children.map((route) => route.path)).toEqual([
      '',
      'users',
      'users/invitations',
      'storage',
      'settings',
      'mail',
    ])
    expect(children.some((route) => route.path.includes('dashboard'))).toBe(false)
  })
})
