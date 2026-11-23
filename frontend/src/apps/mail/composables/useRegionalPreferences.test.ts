import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { registration } from '@/apps/mail/client/policy'
import { createApiClient } from '@/platform/server-state'
import { createTransport } from '@/platform/transport'

// The provider, as far as its region: what it has saved, and the saves it has not answered yet
const provider = vi.hoisted(() => ({
  saved: { locale: 'en-US', time_zone: 'UTC' },
  // Reads asked for while `isSlow` wait here, each answered by calling it
  isSlow: false,
  reads: new Array<() => void>(),
  saves: new Array<{ asked: unknown; take: () => void; refuse: () => void }>(),
}))
// The cache of each test, the newest last
const caches = vi.hoisted(() => new Array<ReturnType<typeof createApiClient>>())

function json(data: unknown) {
  return new Response(JSON.stringify({ data }))
}

function read() {
  return json({ ...provider.saved, locales: [], time_zones: [] })
}

function answer(_url: unknown, init?: RequestInit) {
  if (init?.method !== 'PATCH') {
    if (!provider.isSlow) {
      return Promise.resolve(read())
    }

    return new Promise<Response>((resolve) => provider.reads.push(() => resolve(read())))
  }

  const asked = JSON.parse(String(init.body))
  return new Promise<Response>((resolve) => {
    function take() {
      provider.saved = asked
      resolve(json(null))
    }

    function refuse() {
      const errors = [{ type: 'PermissionError', message: 'Refused' }]
      resolve(new Response(JSON.stringify({ errors }), { status: 403 }))
    }

    provider.saves.push({ asked, take, refuse })
  })
}

/** The real cache and Mail's own rules for it, over the provider above. */
function newCache() {
  return createApiClient(
    { mail: () => Promise.resolve(registration) },
    {
      transport: createTransport({ fetch: vi.fn(answer), retryBaseMs: 0 }),
      realtime: false,
      feedback: vi.fn(),
    },
  )
}

vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  function cache() {
    const newest = caches.at(-1)
    if (!newest) {
      throw new Error('No cache yet')
    }

    return newest
  }

  return {
    api: { mail: api },
    client: {
      mutation: (reference: never, input: never) => cache().client.mutation(reference, input),
    },
    useQuery: (reference: never, input: never) => cache().useQuery(reference, input),
  }
})
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ userResource: { data: { is_suite_cloud_configured: true } } }),
}))

let page: ReturnType<typeof effectScope>
/** Shows the page that holds the region, once its first read has been asked for. */
async function showPage() {
  const { useRegionalPreferences } = await import('./useRegionalPreferences')
  page = effectScope()
  const preferences = page.run(useRegionalPreferences)
  if (!preferences) {
    throw new Error('The page did not show')
  }

  return preferences
}

/** The save the provider has been asked for and has not answered: there is only ever one. */
async function askedSave() {
  await vi.waitFor(() => expect(provider.saves).toHaveLength(1))
  const [save] = provider.saves.splice(0)
  return save
}

/** Lets the answers already given reach the page. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  // Each test gets its own cache, and its own page memory
  caches.push(newCache())
  vi.resetModules()
  provider.saved = { locale: 'en-US', time_zone: 'UTC' }
  provider.isSlow = false
  provider.reads.length = 0
  provider.saves.length = 0
})
afterEach(() => {
  page.stop()
  caches.pop()?.dispose()
})

it('builds the next choice on one the provider took while its page was away', async () => {
  const first = await showPage()
  await vi.waitFor(() => expect(first.region.value?.locale).toBe('en-US'))
  void first.change('locale', 'fr-FR')
  const save = await askedSave()
  page.stop()
  save.take()
  await settle()
  // Back before any newer read has landed
  provider.isSlow = true
  const back = await showPage()
  expect(back.region.value).toEqual({ locale: 'fr-FR', time_zone: 'UTC' })
  void back.change('time_zone', 'Europe/Paris')
  expect((await askedSave()).asked).toEqual({ locale: 'fr-FR', time_zone: 'Europe/Paris' })
})
it('builds a choice on the one still being saved when its page went and came back', async () => {
  const first = await showPage()
  await vi.waitFor(() => expect(first.region.value?.locale).toBe('en-US'))
  void first.change('locale', 'fr-FR')
  const save = await askedSave()
  page.stop()
  const back = await showPage()
  expect(back.region.value).toEqual({ locale: 'fr-FR', time_zone: 'UTC' })
  void back.change('time_zone', 'Europe/Paris')
  save.take()
  expect((await askedSave()).asked).toEqual({ locale: 'fr-FR', time_zone: 'Europe/Paris' })
})
it('keeps showing a later choice while an earlier save and its read land', async () => {
  const { region, change } = await showPage()
  await vi.waitFor(() => expect(region.value?.locale).toBe('en-US'))
  void change('locale', 'fr-FR')
  void change('time_zone', 'Europe/Paris')
  const earlier = await askedSave()
  earlier.take()
  const later = await askedSave()
  await settle()
  expect(region.value).toEqual({ locale: 'fr-FR', time_zone: 'Europe/Paris' })
  later.take()
  await settle()
  expect(region.value).toEqual({ locale: 'fr-FR', time_zone: 'Europe/Paris' })
  expect(provider.saved).toEqual({ locale: 'fr-FR', time_zone: 'Europe/Paris' })
})
it('goes back to the last choice the provider took when a later one is refused', async () => {
  const { region, change } = await showPage()
  await vi.waitFor(() => expect(region.value?.locale).toBe('en-US'))
  void change('locale', 'fr-FR')
  void change('time_zone', 'Europe/Paris')
  const earlier = await askedSave()
  earlier.take()
  const later = await askedSave()
  later.refuse()
  await settle()
  expect(region.value).toEqual({ locale: 'fr-FR', time_zone: 'UTC' })
})
it('shows the saved region again when a save is refused after its page went', async () => {
  const first = await showPage()
  await vi.waitFor(() => expect(first.region.value?.locale).toBe('en-US'))
  void first.change('locale', 'fr-FR')
  const save = await askedSave()
  page.stop()
  save.refuse()
  await settle()
  provider.isSlow = true
  const back = await showPage()
  expect(back.region.value).toEqual({ locale: 'en-US', time_zone: 'UTC' })
})
