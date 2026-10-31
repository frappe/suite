import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

const boundary = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('@/api', async () => {
  const { api: mail } = await import('@/apps/mail/client/generated')
  const { createApiClient } = await import('@/platform/server-state')
  const engine = createApiClient(
    { mail: async () => ({ policy: () => ({ staleTime: 0 }) }) },
    { persistence: false, transport: { request: boundary.fetch } },
  )
  return { api: { mail }, useQuery: engine.useQuery }
})
const { useEnabledDomains } = await import('./useEnabledDomains')
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  boundary.fetch.mockReset()
})
function picker(show = ref(false)) {
  const scope = effectScope()
  scopes.push(scope)
  return { show, ...scope.run(() => useEnabledDomains(show))! }
}
describe('the domains offered by an add dialog', () => {
  it('loads only while open and refreshes on reopening', async () => {
    boundary.fetch.mockResolvedValue(['example.com'])
    const { show, domains } = picker()
    expect(boundary.fetch).not.toHaveBeenCalled()
    show.value = true
    await vi.waitFor(() => expect(domains.data).toEqual(['example.com']))
    show.value = false
    show.value = true
    await vi.waitFor(() => expect(boundary.fetch).toHaveBeenCalledTimes(2))
  })
  it('reports a failed read and can recover when reopened', async () => {
    boundary.fetch.mockRejectedValue(new Error('Suite Cloud is unreachable'))
    const { show, domains, domainsError } = picker(ref(true))
    await vi.waitFor(() => expect(domainsError.value).toBe('Suite Cloud is unreachable'))
    show.value = false
    boundary.fetch.mockResolvedValue([])
    show.value = true
    await vi.waitFor(() => expect(domains.data).toEqual([]))
    expect(domainsError.value).toBe('')
  })
})
