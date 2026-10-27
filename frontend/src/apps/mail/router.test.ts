import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'

import { mailGuard } from './router'

const state = vi.hoisted(() => ({
  user: {} as Record<string, unknown> | undefined,
  mailboxes: [{ id: 'inbox' }] as { id: string }[] | undefined,
  fetched: [] as string[],
}))

vi.mock('@/router', () => ({ default: {} }))
vi.mock('@/boot/session', () => ({ useSessionStore: () => ({ isLoggedIn: true }) }))
vi.mock('@/platform/session', () => ({
  registerAccountReader: vi.fn(),
  useSession: () => ({
    user: { value: null },
    onLogout: vi.fn(),
    capabilities: { value: { suiteAdmin: !!state.user.is_suite_admin } },
  }),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    userResource: {
      get data() {
        return state.user
      },
    },
    loadUser: () => {
      state.fetched.push('user')
      state.user ??= { is_jmap_configured: true }
      return Promise.resolve(state.user)
    },
    mailboxes: {
      refetch: () => {
        state.fetched.push('mailboxes')
        return Promise.resolve()
      },
      get data() {
        return state.mailboxes
      },
    },
    resolveAccount: () => {},
    accountId: 'acc',
    mailboxIds: {},
  }),
}))

const replace = vi.fn()
const to = (
  name: string,
  meta: Record<string, unknown> = {},
  params: Record<string, string> = {},
) => ({ name, meta, params, query: {} }) as unknown as RouteLocationNormalized
const dashboard = to('mail-domains', { isDashboard: true })

describe('who reaches the Admin Dashboard', () => {
  beforeEach(() => {
    replace.mockClear()
    vi.stubGlobal('window', { location: { replace } })
    vi.stubGlobal('document', { referrer: '' })
  })

  it('an admin of a site connected to a Suite Cloud', async () => {
    state.user = { is_jmap_configured: true, is_suite_admin: true, is_suite_cloud_configured: true }
    expect(await mailGuard(dashboard)).toBeUndefined()
  })

  it('not an admin of a site without one: they keep their mailbox', async () => {
    state.user = {
      is_jmap_configured: true,
      is_suite_admin: true,
      is_suite_cloud_configured: false,
    }
    expect(await mailGuard(dashboard)).toEqual('/admin')
  })

  it('not someone with a mailbox who is no admin', async () => {
    state.user = {
      is_jmap_configured: true,
      is_suite_admin: false,
      is_suite_cloud_configured: true,
    }
    expect(await mailGuard(dashboard)).toEqual('/home')
  })

  it('an admin without a mailbox lands on it when the site is connected', async () => {
    state.user = {
      is_jmap_configured: false,
      is_suite_admin: true,
      is_suite_cloud_configured: true,
    }
    expect(await mailGuard(to('mail-root-shortcut'))).toEqual('/admin')
    expect(replace).not.toHaveBeenCalled()
  })

  it('an admin without a mailbox has nothing in Mail when it is not', async () => {
    state.user = {
      is_jmap_configured: false,
      is_suite_admin: true,
      is_suite_cloud_configured: false,
    }
    expect(await mailGuard(dashboard)).toEqual('/admin')
    expect(await mailGuard(to('mail-root-shortcut', { shortcut: true }))).toBeUndefined()
    expect(replace).not.toHaveBeenCalled()
  })

  it('anyone without a mailbox opens a MIME page', async () => {
    state.user = {
      is_jmap_configured: false,
      is_suite_admin: false,
      is_suite_cloud_configured: false,
    }
    expect(
      await mailGuard(to('mail-mime-message', { allowGuest: true }, { id: 'm1' })),
    ).toBeUndefined()
  })
})

describe('mail without a Suite Cloud', () => {
  it('opens for anyone with a mailbox', async () => {
    state.user = {
      is_jmap_configured: true,
      is_suite_admin: false,
      is_suite_cloud_configured: false,
    }
    const mailbox = to('mail-mailbox', {}, { accountId: 'acc', mailbox: 'inbox' })
    expect(await mailGuard(mailbox)).toBeUndefined()
  })
})

describe('what a navigation waits for', () => {
  beforeEach(() => {
    state.fetched = []
    state.mailboxes = [{ id: 'inbox' }]
  })
  const thread = to('mail-mail', {}, { accountId: 'acc', mailbox: 'inbox', threadID: 't1' })

  it('nothing, once the user and the mailboxes are loaded: opening a thread fetches neither', async () => {
    state.user = { is_jmap_configured: true }
    await mailGuard(thread)
    expect(state.fetched).toEqual([])
  })

  it('the user and the mailboxes, when not loaded yet', async () => {
    state.user = undefined
    state.mailboxes = undefined
    await mailGuard(thread)
    expect(state.fetched).toEqual(['user', 'mailboxes'])
  })
})
