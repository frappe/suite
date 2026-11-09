import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, ref } from 'vue'

import GetStarted from '@/composition/home/GetStarted.vue'

interface Domain {
  id: string
  name: string
  is_verified: boolean
  created_at: string
}

interface Person {
  kind: 'user'
  name: string
}

interface ServerState {
  admin: boolean
  cloud: boolean
  jmap: boolean
  avatar: string | null
  hidden: boolean
  domains: Domain[]
  invitations: number
  people: Person[]
  imports: number
  logo: string
  update: ReturnType<typeof vi.fn>
  settings: ReturnType<typeof vi.fn>
}

// What the server says, per query, for the person viewing Home.
const server = vi.hoisted<ServerState>(() => ({
  admin: true,
  cloud: true,
  jmap: true,
  avatar: null,
  hidden: false,
  domains: [],
  invitations: 0,
  people: [],
  imports: 0,
  logo: '',
  update: vi.fn(),
  settings: vi.fn(),
}))

vi.mock('@/api', async () => {
  const { reactive } = await import('vue')
  const data = new Map<string, () => unknown>([
    [
      'onboarding_get',
      () => ({
        cloud: server.cloud,
        domains: server.domains.filter((d) => d.is_verified).map((d) => d.name),
      }),
    ],
    ['get_domains', () => ({ items: server.domains, total: server.domains.length })],
    ['get_account_requests', () => ({ items: [], total: server.invitations })],
    [
      'people_get',
      () => ({
        rows: [
          { kind: 'user', name: 'me' },
          { kind: 'user', name: 'Administrator' },
          ...server.people,
        ],
      }),
    ],
    ['exchange_list', () => ({ items: [], total: server.imports })],
  ])
  return {
    api: (await import('@/composition/api')).api,
    useQuery: (reference: { id: string }, params?: () => unknown) => {
      const enabled = typeof params !== 'function' || params() !== false
      return reactive({
        // A query that is turned off reads as pending, as the real one does.
        status: enabled ? 'success' : 'pending',
        data: enabled ? data.get(reference.id)?.() : undefined,
        refetch: vi.fn(),
      })
    },
    useMutation: () => reactive({ isPending: false, error: null, run: server.update }),
  }
})
vi.mock('@/platform/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/session')>()
  return {
    ...original,
    useSession: () => ({
      ...original.useSession(),
      user: ref({ id: 'me', avatar: server.avatar, get_started_hidden: server.hidden }),
      capabilities: ref({ suiteAdmin: server.admin, jmap: server.jmap, systemManager: false }),
    }),
  }
})
vi.mock('@/platform/workspace', () => ({
  useWorkspace: () => ({ workspaceName: ref('Acme'), workspaceLogo: ref(server.logo) }),
}))
vi.mock('@/platform/settings', () => ({ openSettings: server.settings }))

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  Object.assign(server, {
    admin: true,
    cloud: true,
    jmap: true,
    avatar: null,
    hidden: false,
    domains: [],
    invitations: 0,
    people: [],
    imports: 0,
    logo: '',
  })
  server.update.mockReset()
  server.settings.mockReset()
})

describe('Get started on Home', () => {
  it('gives a Suite Cloud Admin the workspace tasks, ticked from what the workspace has', () => {
    server.domains = [
      { id: 'd1', name: 'acme.frappe.space', is_verified: true, created_at: '2026-01-01' },
      { id: 'd2', name: 'acme.com', is_verified: false, created_at: '2026-01-02' },
    ]
    server.invitations = 2
    server.logo = '/files/logo.png'
    const root = mount()

    expect(titles(root)).toEqual([
      'Finish connecting acme.com',
      'Invite your team (done)',
      'Bring your old mail',
      'Add your logo (done)',
    ])
    expect(root.textContent).toContain('2 of 4 done')
  })

  it('leaves the domain out on a self-hosted site and counts the team from accounts', () => {
    server.cloud = false
    server.people = [{ kind: 'user', name: 'ana' }]
    const root = mount()

    expect(titles(root)).toEqual([
      'Invite your team (done)',
      'Bring your old mail',
      'Add your logo',
    ])
  })

  it('gives someone who joined only their own tasks', () => {
    server.admin = false
    server.avatar = '/files/me.png'
    server.imports = 1
    const root = mount()

    expect(titles(root)).toEqual(['Add a profile photo (done)', 'Bring your old mail (done)'])
    expect(root.textContent).toContain("You're all set")
  })

  it('opens the profile in Settings for the photo task', async () => {
    server.admin = false
    const root = mount()
    task(root, 'Add a profile photo').click()
    expect(server.settings).toHaveBeenCalledWith('account.profile')
  })

  it('stays hidden for the person once they hide it', async () => {
    server.update.mockResolvedValue({})
    const root = mount()
    button(root, 'Hide').click()
    await nextTick()

    expect(server.update).toHaveBeenCalledWith({ get_started_hidden: true })
    expect(root.querySelector('section')).toBeNull()

    server.hidden = true
    expect(mount().querySelector('section')).toBeNull()
  })
})

function mount(): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(GetStarted)
  app.mount(root)
  cleanups.push(() => {
    app.unmount()
    root.remove()
  })
  return root
}
function titles(root: HTMLElement): string[] {
  return [...root.querySelectorAll('li button > span:nth-child(2) > span:first-child')].map(
    (title) => title.textContent!.replace(/\s+/g, ' ').trim(),
  )
}
function task(root: HTMLElement, title: string): HTMLButtonElement {
  return [...root.querySelectorAll<HTMLButtonElement>('li button')].find((b) =>
    b.textContent?.includes(title),
  )!
}
function button(root: HTMLElement, label: string): HTMLButtonElement {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => (b.textContent?.trim() || b.getAttribute('label')) === label,
  )!
}
