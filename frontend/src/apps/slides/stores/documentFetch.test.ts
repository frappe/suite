import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const server = vi.hoisted(() => ({ fetch: vi.fn() }))
const visits: string[] = []
const served = {
  name: 'p1',
  node: 'node-1',
  modified: 'M1',
  modified_by: 'me@example.com',
  is_composite: 0,
  theme: null,
  slides: [],
}
vi.mock('@/api', async () => {
  const { createApiClient } = await import('@/platform/server-state')
  const { createTransport } = await import('@/platform/transport')
  const { api: slides } = await import('../client/api')
  const { registration } = await import('../client/policy')
  return {
    api: { slides },
    ...createApiClient(
      { slides: async () => registration },
      { transport: createTransport({ fetch: server.fetch }) },
    ),
  }
})
vi.mock('frappe-ui', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }))
vi.mock('./driveVisit', () => ({ recordVisit: async (node: string) => void visits.push(node) }))
vi.mock('@/apps/slides/router', () => ({ router: { currentRoute: { value: { query: {} } } } }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides: ref([]) }))
vi.mock('@/apps/slides/stores/historyMeta', () => ({ commandHistory: {} }))
vi.mock('@/apps/slides/stores/element', () => ({ normalizeZIndices: (els: unknown[]) => els }))

const { initPresentationDoc, setDocumentContext } = await import('./presentation')

const answer = (message: unknown) => new Response(JSON.stringify({ message }), { status: 200 })

describe('where the presentation requests go', () => {
  beforeEach(() => {
    server.fetch.mockReset()
    server.fetch.mockResolvedValue(answer(served))
    visits.length = 0
  })

  it('loads an ordinary page through the shared client and records the node visit', async () => {
    await initPresentationDoc('p1')
    expect(server.fetch.mock.calls[0][0]).toBe(
      '/api/method/suite.slides.doctype.presentation.presentation.get_public_presentation?name=p1',
    )
    expect(visits).toEqual(['node-1'])
  })

  it('the surface sends loads through its session fetch and records no visit itself', async () => {
    const sent: Array<{ url: string; init?: RequestInit }> = []
    server.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
      sent.push({ url, init })
      return answer(served)
    })
    const release = setDocumentContext('p1', context('p1'))

    await initPresentationDoc('p1')
    release()

    expect(new Headers(sent[0].init?.headers).get('X-Drive-Links')).toBe('p1')
    expect(visits).toEqual([])
    expect(sent[0].url).toBe(
      '/api/method/suite.slides.doctype.presentation.presentation.get_public_presentation?name=p1',
    )
    expect(sent[0].init?.method).toBe('GET')
  })

  it('releasing an older surface leaves the newer surface in place', async () => {
    const older = setDocumentContext('p1', context('older'))
    const releaseNewer = setDocumentContext('p1', context('newer'))
    older()
    await initPresentationDoc('p1')
    expect(new Headers(server.fetch.mock.calls[0][1].headers).get('X-Drive-Links')).toBe('newer')
    releaseNewer()
  })
})

function context(code: string) {
  return { partition: () => code, scope: () => ({ headers: { 'X-Drive-Links': code } }) }
}
