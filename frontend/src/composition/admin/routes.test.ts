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
      'storage',
      'settings',
      'mail',
    ])
    expect(children.some((route) => route.path.includes('dashboard'))).toBe(false)
  })

  it('retains domain, group, mailing-list and report management under Admin', () => {
    const mail = routes[0].children!.find((route) => route.path === 'mail')!
    expect(mail.children!.map((route) => route.name)).toContain('mail-domains')
    expect(mail.children!.map((route) => route.name)).toContain('mail-groups')
    expect(mail.children!.map((route) => route.name)).toContain('mail-dmarc-reports')
    expect(mail.children!.map((route) => route.name)).toContain('mail-tls-reports')
    expect(mail.meta?.area).toBe('admin')
  })
})
