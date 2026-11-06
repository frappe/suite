import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { api } from '@/api'
import { driveLinks } from '@/apps/drive/client/links'
import { createRealtime, type SocketLike } from '@/platform/realtime'
import { createTransport, TransportError } from '@/platform/transport'
import { setTweaks } from '@/platform/tweaks'

import { createApiClient } from './index'

function node(title = 'Budget', name = 'budget') {
  return {
    name,
    title,
    kind: 'file',
    parent_node: 'root',
    root: 'root',
    state: 'Active',
    trash_root: null,
    size: 3,
    mime: 'text/plain',
    url: null,
    content_doctype: null,
    content_docname: null,
    is_template: 0,
    owner: { id: 'alice', full_name: 'Alice', user_image: null },
    creation: null,
    modified: null,
    content_modified: null,
  }
}
function answer(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { data } : { errors: [data] }), { status })
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const fetcher = vi.fn<typeof fetch>()
const feedback = vi.fn()
let engine: ReturnType<typeof createApiClient>
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  fetcher.mockReset()
  feedback.mockReset()
  driveLinks.clear()
  engine = createApiClient(
    {
      suite: () => import('@/platform/transport/policy').then((module) => module.registration),
      drive: () => import('@/apps/drive/client/policy').then((module) => module.registration),
      mail: () => import('@/apps/mail/client/policy').then((module) => module.registration),
    },
    {
      transport: createTransport({ fetch: fetcher, retryBaseMs: 0 }),
      feedback,
    },
  )
})
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  engine.dispose()
  vi.restoreAllMocks()
})
function observe<T>(create: () => T): T {
  const scope = effectScope()
  scopes.push(scope)
  const result = scope.run(create)
  if (!result) throw new Error('Observer did not initialize')
  return result
}
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('Suite API references and shared client', () => {
  it('updates WebDAV switches immediately, rolls back refusals, and reconciles successful saves', async () => {
    let globallyEnabled = true
    let userEnabled = false
    const writes = Array.from({ length: 5 }, () => deferred<Response>())
    let write = 0
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH') return writes[write++].promise
      return answer({
        globally_enabled: globallyEnabled,
        is_admin: true,
        server_url: 'https://suite.test/webdav',
        username: 'alice',
        enabled_for_user: userEnabled,
        two_factor_blocked: false,
        api_key: null,
      })
    })
    const webdav = observe(() => engine.useQuery(api.drive.webdav.get, {}))
    await vi.waitFor(() => expect(webdav.data).toMatchObject({ enabled_for_user: false }))

    const user = engine.useMutation(api.drive.settings.update)
    const refused = user.run({ webdav_enabled: true })
    const rejection = expect(refused).rejects.toMatchObject({ status: 403 })
    await vi.waitFor(() => expect(webdav.data).toMatchObject({ enabled_for_user: true }))
    expect(user.isPending).toBe(true)
    writes[0].resolve(answer({ type: 'Permission', message: 'Access refused' }, 403))
    await rejection
    expect(webdav.data).toMatchObject({ globally_enabled: true, enabled_for_user: false })
    expect(user.isPending).toBe(false)
    expect(feedback).toHaveBeenCalledOnce()

    const saved = user.run({ webdav_enabled: true })
    await vi.waitFor(() => expect(webdav.data).toMatchObject({ enabled_for_user: true }))
    userEnabled = true
    writes[1].resolve(answer({ webdav_enabled: true, writer_settings: {} }))
    await saved
    await vi.waitFor(() => expect(webdav.data).toMatchObject({ enabled_for_user: true }))

    const site = engine.useMutation(api.drive.siteSettings.update)
    const disabled = site.run({ webdav_enabled: false })
    await vi.waitFor(() => expect(webdav.data).toMatchObject({ globally_enabled: false }))
    expect(site.isPending).toBe(true)
    globallyEnabled = false
    writes[2].resolve(
      answer({
        is_admin: true,
        preview_size: 1024,
        webdav_enabled: false,
        webdav_allowed_methods: 'GET',
        default_personal_quota: 0,
        shared_quota: 0,
      }),
    )
    await disabled
    await vi.waitFor(() => expect(webdav.data).toMatchObject({ globally_enabled: false }))
    expect(site.isPending).toBe(false)
    expect(feedback).toHaveBeenCalledOnce()

    const refusedSite = site.run({ webdav_enabled: true })
    const siteRejection = expect(refusedSite).rejects.toMatchObject({ status: 403 })
    await vi.waitFor(() => expect(webdav.data).toMatchObject({ globally_enabled: true }))
    await webdav.refetch()
    expect(webdav.data).toMatchObject({ globally_enabled: true, enabled_for_user: true })
    writes[3].resolve(answer({ type: 'Permission', message: 'Access refused' }, 403))
    await siteRejection
    expect(webdav.data).toMatchObject({ globally_enabled: false, enabled_for_user: true })
    expect(feedback).toHaveBeenCalledTimes(2)

    const cancellation = new AbortController()
    const canceled = engine.client.mutation(
      api.drive.siteSettings.update,
      { webdav_enabled: true },
      { signal: cancellation.signal },
    )
    const aborted = expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(webdav.data).toMatchObject({ globally_enabled: true }))
    cancellation.abort()
    await aborted
    expect(webdav.data).toMatchObject({ globally_enabled: false, enabled_for_user: true })
    expect(feedback).toHaveBeenCalledTimes(2)
  })
  it('pages offset readers through exhaustion and discards pages from an old filter', async () => {
    const delayed = deferred<Response>()
    const members = ['alice', 'bob', 'cara'].map((name) => ({
      name,
      full_name: name,
      user_image: '',
      last_active: null,
      enabled: true,
      account: name,
      is_admin: false,
      quota_gb: null,
      used_bytes: null,
    }))
    fetcher.mockImplementation(async (_url, options) => {
      const input: unknown = JSON.parse(String(options?.body))
      if (
        !input ||
        typeof input !== 'object' ||
        !('start' in input) ||
        typeof input.start !== 'number' ||
        !('page_length' in input) ||
        typeof input.page_length !== 'number'
      )
        throw new Error('Expected pagination input')
      if ('search' in input && input.search === 'slow') return delayed.promise
      const items = 'search' in input && input.search === 'bob' ? members.slice(1, 2) : members
      return new Response(
        JSON.stringify({
          message: {
            items: items.slice(input.start, input.start + input.page_length),
            total: items.length,
          },
        }),
      )
    })
    const search = ref('')
    const page = observe(() =>
      engine.useInfiniteQuery(api.mail.admin.members.list, () => ({
        search: search.value,
        start: 0,
        page_length: 2,
      })),
    )
    await vi.waitFor(() => expect(page.rows.map((row) => row.name)).toEqual(['alice', 'bob']))
    expect(page.total).toBe(3)
    expect(page.hasNext).toBe(true)
    await page.fetchNext()
    expect(page.rows.map((row) => row.name)).toEqual(['alice', 'bob', 'cara'])
    expect(page.hasNext).toBe(false)
    const count = fetcher.mock.calls.length
    await page.fetchNext()
    expect(fetcher).toHaveBeenCalledTimes(count)
    search.value = 'slow'
    await flush()
    search.value = 'bob'
    await vi.waitFor(() => expect(page.rows.map((row) => row.name)).toEqual(['bob']))
    delayed.resolve(new Response(JSON.stringify({ message: { items: members, total: 3 } })))
    await flush()
    expect(page.rows.map((row) => row.name)).toEqual(['bob'])
    expect(page.hasNext).toBe(false)
  })

  it('shares sender-blocking optimism, rolls back a refusal, and keeps other accounts separate', async () => {
    const write = deferred<Response>()
    fetcher.mockImplementation(async (url) =>
      String(url).endsWith('screen_email_addresses')
        ? write.promise
        : new Response(
            JSON.stringify({
              message: [{ email: '@example.com', action: 'Spam', creation: '', modified: '' }],
            }),
          ),
    )
    const first = observe(() => engine.useQuery(api.mail.screening.list, { account: 'alice' }))
    const second = observe(() => engine.useQuery(api.mail.screening.list, { account: 'bob' }))
    await vi.waitFor(() => expect(first.data).toHaveLength(1))
    await vi.waitFor(() => expect(second.data).toHaveLength(1))
    const pending = engine.client
      .mutation(api.mail.screening.set, {
        account: 'alice',
        emails: ['sender@example.com'],
        action: 'Spam',
      })
      .catch((cause) => cause)
    await vi.waitFor(() =>
      expect(first.data?.map((row) => row.email)).toEqual(['@example.com', 'sender@example.com']),
    )
    expect(second.data?.map((row) => row.email)).toEqual(['@example.com'])
    write.resolve(
      new Response(JSON.stringify({ exc_type: 'PermissionError', exception: 'Denied' }), {
        status: 403,
      }),
    )
    expect(await pending).toBeInstanceOf(TransportError)
    expect(first.data?.map((row) => row.email)).toEqual(['@example.com'])
    expect(feedback).toHaveBeenCalledTimes(1)
  })

  it('reads three owners and disables reactive selection without publishing an old reply', async () => {
    const old = deferred<Response>()
    fetcher.mockImplementation(async (url) => {
      const path = String(url)
      if (path.endsWith('/account')) return answer(null)
      if (path.includes('inbox-summary')) return answer({ unread: 7 })
      if (path.includes('nodes/old')) return old.promise
      return answer(node('Forecast', 'new'))
    })
    expect(await engine.client.query(api.suite.account.get)).toBeNull()
    expect(await engine.client.query(api.mail.inbox.summary)).toEqual({ unread: 7 })
    const selection = ref('old')
    const detail = observe(() =>
      engine.useQuery(api.drive.nodes.get, () =>
        selection.value ? { node: selection.value } : false,
      ),
    )
    await flush()
    selection.value = 'new'
    await vi.waitFor(() => expect(detail.data?.name).toBe('new'))
    old.resolve(answer(node('Old', 'old')))
    await flush()
    expect(detail.data?.title).toBe('Forecast')
    selection.value = ''
    expect(detail.data).toBeUndefined()
    expect(detail.isFetching).toBe(false)
    const before = fetcher.mock.calls.length
    expect(await detail.refetch()).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(before)
  })

  it('shares reads, cancels only one wait, fetches imperative reads by default, and opts into cache reuse', async () => {
    const response = deferred<Response>()
    fetcher.mockImplementation(() => response.promise)
    const canceled = new AbortController()
    const first = engine.client
      .query(api.drive.nodes.get, { node: 'budget' }, { signal: canceled.signal })
      .catch((cause) => cause)
    const second = engine.client.query(api.drive.nodes.get, { node: 'budget' })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    canceled.abort()
    expect((await first).name).toBe('AbortError')
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    response.resolve(answer(node()))
    expect((await second).title).toBe('Budget')
    fetcher.mockResolvedValue(answer(node('Fresh')))
    expect(
      (await engine.client.query(api.drive.nodes.get, { node: 'budget' }, { cache: 'prefer' }))
        .title,
    ).toBe('Budget')
    expect((await engine.client.query(api.drive.nodes.get, { node: 'budget' })).title).toBe('Fresh')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('detaches an observer without canceling another observer or an imperative reader', async () => {
    const response = deferred<Response>()
    fetcher.mockImplementation(() => response.promise)
    const first = observe(() => engine.useQuery(api.drive.nodes.get, { node: 'budget' }))
    const second = observe(() => engine.useQuery(api.drive.nodes.get, { node: 'budget' }))
    const outside = engine.client.query(api.drive.nodes.get, { node: 'budget' })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    first.cancel()
    response.resolve(answer(node()))
    expect((await outside).title).toBe('Budget')
    await vi.waitFor(() => expect(second.data?.title).toBe('Budget'))
    expect(first.data).toBeUndefined()
    fetcher.mockResolvedValue(answer(node('Again')))
    expect((await first.refetch())?.title).toBe('Again')
  })

  it('reconciles detail and loaded lists, rejects refusals, and reports each failed write once', async () => {
    let title = 'Budget'
    fetcher.mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') {
        const input: unknown = JSON.parse(String(init.body))
        if (
          !input ||
          typeof input !== 'object' ||
          !('title' in input) ||
          typeof input.title !== 'string'
        )
          throw new Error('Expected a rename title')
        if (input.title === 'Forbidden')
          return answer({ type: 'DriveForbidden', message: 'Read only' }, 403)
        title = input.title
        return answer(node(title))
      }
      return String(url).includes('/children')
        ? answer({ rows: [node(title)], next_cursor: null })
        : answer(node(title))
    })
    const detail = observe(() => engine.useQuery(api.drive.nodes.get, { node: 'budget' }))
    const list = observe(() => engine.useInfiniteQuery(api.drive.nodes.children, { node: 'root' }))
    await vi.waitFor(() => expect(list.rows).toHaveLength(1))
    await engine.client.mutation(api.drive.nodes.rename, { node: 'budget', title: 'Forecast' })
    expect(detail.data?.title).toBe('Forecast')
    expect(list.rows[0]?.title).toBe('Forecast')
    const rename = observe(() => engine.useMutation(api.drive.nodes.rename))
    await expect(rename.run({ node: 'budget', title: 'Forbidden' })).rejects.toMatchObject({
      type: 'DriveForbidden',
      status: 403,
    })
    expect(rename.error).toBeInstanceOf(TransportError)
    expect(rename.isPending).toBe(false)
    expect(detail.data?.title).toBe('Forecast')
    expect(feedback).toHaveBeenCalledTimes(1)
    await expect(
      engine.client.mutation(
        api.drive.nodes.rename,
        { node: 'budget', title: 'Forbidden' },
        { silent: true },
      ),
    ).rejects.toBeInstanceOf(TransportError)
    expect(feedback).toHaveBeenCalledTimes(1)
  })

  it('keeps ordinary writes in call order and rolls back canceled optimism without a refusal', async () => {
    const sent: string[] = []
    const pending = deferred<Response>()
    let savedTitle = 'Budget'
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method !== 'PATCH') return answer(node(savedTitle))
      const input: unknown = JSON.parse(String(init.body))
      if (
        !input ||
        typeof input !== 'object' ||
        !('title' in input) ||
        typeof input.title !== 'string'
      )
        throw new Error('Expected a rename title')
      const { title } = input
      sent.push(title)
      if (title === 'First') return pending.promise
      savedTitle = title
      return answer(node(title))
    })
    const detail = observe(() => engine.useQuery(api.drive.nodes.get, { node: 'budget' }))
    await vi.waitFor(() => expect(detail.data?.title).toBe('Budget'))
    const first = observe(() => engine.useMutation(api.drive.nodes.rename))
    const canceled = first.run({ node: 'budget', title: 'First' }).catch((cause) => cause)
    const second = engine.client.mutation(api.drive.nodes.rename, {
      node: 'budget',
      title: 'Second',
    })
    await vi.waitFor(() => expect(detail.data?.title).toBe('First'))
    expect(sent).toEqual(['First'])
    first.cancel()
    expect((await canceled).name).toBe('AbortError')
    expect(first.error).toBeNull()
    await second
    pending.resolve(answer(node('First')))
    await flush()
    expect(detail.data?.title).toBe('Second')
    expect(feedback).not.toHaveBeenCalled()
  })

  it('settles once every write has landed, a write called while waiting included', async () => {
    const pending = deferred<Response>()
    fetcher.mockImplementation(async (_url, init) => {
      const input: unknown = JSON.parse(String(init?.body))
      if (
        !input ||
        typeof input !== 'object' ||
        !('title' in input) ||
        typeof input.title !== 'string'
      )
        throw new Error('Expected a rename title')
      const { title } = input
      return title === 'First' ? pending.promise : answer(node(title))
    })
    const landed: string[] = []
    void engine.client
      .mutation(api.drive.nodes.rename, { node: 'budget', title: 'First' })
      .then(() => landed.push('First'))
    const settled = engine.writesSettled().then(() => landed.push('settled'))
    void engine.client
      .mutation(api.drive.nodes.rename, { node: 'budget', title: 'Second' })
      .then(() => landed.push('Second'))
    pending.resolve(answer(node('First')))
    await settled
    expect(landed).toEqual(['First', 'Second', 'settled'])
  })

  it('isolates identity and Drive links and scopes named and covered-node calls', async () => {
    const pending = deferred<Response>()
    const code = 'L000000000000000000001'
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH')
        return answer({
          name: 'g',
          node: 'budget',
          principal: '$LINK:x',
          role: 10,
          expires_on: null,
          has_password: false,
          sent_to: null,
        })
      return pending.promise
    })
    driveLinks.seed(code, 'budget')
    const old = engine.client.query(api.drive.nodes.get, { node: 'budget' }).catch((cause) => cause)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('X-Drive-Links')).toBe(code)
    engine.resetIdentity()
    pending.resolve(answer(node('Previous identity')))
    expect((await old).name).toBe('AbortError')
    fetcher.mockResolvedValue(answer(node('New identity')))
    expect(
      (await engine.client.query(api.drive.nodes.get, { node: 'budget' }, { cache: 'prefer' }))
        .title,
    ).toBe('New identity')
    fetcher.mockResolvedValue(
      answer({
        name: 'g',
        node: 'budget',
        principal: '$LINK:x',
        role: 10,
        expires_on: null,
        has_password: false,
        sent_to: null,
      }),
    )
    const written = await engine.client.mutation(api.drive.grants.update, {
      node: 'budget',
      grant: 'g',
      role: 10,
    })
    expect(written.role).toBe(10)
    const sent = fetcher.mock.calls.at(-1)?.[1]
    expect(new Headers(sent?.headers).get('X-Drive-Links')).toBe(code)
    expect(JSON.parse(String(sent?.body))).not.toHaveProperty('node')
  })

  it('pages to exhaustion and resets when domain arguments change', async () => {
    fetcher.mockImplementation(async (url) => {
      const input = new URL(String(url), 'http://suite.test').searchParams
      const q = input.get('q') ?? 'a'
      return answer({
        rows: [{ kind: 'group', name: q + (input.has('cursor') ? '-2' : '-1'), member_count: 3 }],
        next_cursor: input.has('cursor') ? null : 'next',
      })
    })
    const term = ref('a')
    const people = observe(() =>
      engine.useInfiniteQuery(api.suite.people.list, () => ({ q: term.value })),
    )
    await vi.waitFor(() => expect(people.rows).toHaveLength(1))
    await people.fetchNext()
    expect(people.rows.map((row) => row.name)).toEqual(['a-1', 'a-2'])
    expect(people.hasNext).toBe(false)
    const count = fetcher.mock.calls.length
    await people.fetchNext()
    expect(fetcher).toHaveBeenCalledTimes(count)
    term.value = 'b'
    await vi.waitFor(() => expect(people.rows.map((row) => row.name)).toEqual(['b-1']))
  })

  it('retries safe reads, never retries writes, and preserves a declined challenge refusal', async () => {
    fetcher
      .mockResolvedValueOnce(answer({ type: 'TemporaryError', message: 'Retry' }, 503))
      .mockResolvedValueOnce(answer(node()))
    expect((await engine.client.query(api.drive.nodes.get, { node: 'budget' })).title).toBe(
      'Budget',
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
    engine.onChallenge('DriveForbidden', async () => undefined)
    fetcher.mockResolvedValue(answer({ type: 'DriveForbidden', message: 'Read only' }, 403))
    await expect(
      engine.client.mutation(api.drive.nodes.rename, { node: 'budget', title: 'No' }),
    ).rejects.toMatchObject({ type: 'DriveForbidden' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('unlocks through a queued mutation and explicitly retries the challenged write', async () => {
    let unlocked = false
    const sent: string[] = []
    fetcher.mockImplementation(async (url, init) => {
      sent.push(String(url))
      if (String(url).includes('/unlock')) {
        unlocked = true
        return answer({ ticket: 'ticket', expires: 1234567890 })
      }
      if (init?.method === 'PATCH' && !unlocked)
        return answer({ type: 'DriveLocked', message: 'Password required' }, 401)
      return answer(node('Unlocked'))
    })
    engine.onChallenge('DriveLocked', async (_error, retry) => {
      await engine.client.mutation(api.drive.links.unlock, { token: 'link', password: 'secret' })
      return retry()
    })
    await expect(
      engine.client.mutation(api.drive.nodes.rename, { node: 'budget', title: 'Unlocked' }),
    ).resolves.toMatchObject({ title: 'Unlocked' })
    expect(sent).toHaveLength(3)
    expect(feedback).not.toHaveBeenCalled()
  })

  it('runs and resumes a typed byte transfer through the same client and cancels without a refusal', async () => {
    const methods: string[] = []
    fetcher.mockImplementation(async (url, init) => {
      methods.push(init?.method ?? 'GET')
      if (String(url).endsWith('/finish')) return answer(node('Uploaded', 'uploaded'))
      if (init?.method === 'PUT') return answer({ upload_id: 'upload-1', received: 12 })
      return answer({ upload_id: 'upload-1', mode: 'chunked' })
    })
    const transfer = observe(() => engine.useUpload(api.drive.uploads.transfer))
    const file = new Blob(['hello world!'])
    const uploaded = await transfer.run({ parent_node: 'root', file, filename: 'Greeting.txt' })
    expect(uploaded.name).toBe('uploaded')
    expect(methods).toEqual(['POST', 'PUT', 'POST'])
    expect(transfer.progress).toBe(100)
    expect(transfer.isPending).toBe(false)
    methods.length = 0
    await transfer.run({
      parent_node: 'root',
      file,
      start: { session: { upload_id: 'upload-1', mode: 'chunked' }, offset: 5 },
    })
    expect(methods).toEqual(['PUT', 'POST'])
    const canceled = transfer.run({ parent_node: 'root', file }).catch((cause) => cause)
    transfer.cancel()
    expect((await canceled).name).toBe('AbortError')
    expect(transfer.error).toBeNull()
    expect(transfer.isPending).toBe(false)
    expect(feedback).not.toHaveBeenCalled()
  })

  it('fetches reads again on coming back after a while away, not on focus or a glance away', async () => {
    fetcher.mockImplementation(async () =>
      answer({
        globally_enabled: true,
        is_admin: true,
        server_url: 'https://suite.test/webdav',
        username: 'alice',
        enabled_for_user: false,
        two_factor_blocked: false,
        api_key: null,
      }),
    )
    const webdav = observe(() => engine.useQuery(api.drive.webdav.get, {}))
    await vi.waitFor(() => expect(webdav.data).toBeTruthy())
    const fetches = () => fetcher.mock.calls.length
    const before = fetches()

    let state: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state)
    const now = vi.spyOn(Date, 'now')
    const leaveFor = async (ms: number) => {
      now.mockReturnValue(1_000_000)
      state = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      now.mockReturnValue(1_000_000 + ms)
      state = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      await flush()
    }

    // Clicking back out of a mail's frame gives the window focus.
    window.dispatchEvent(new Event('focus'))
    await leaveFor(5_000)
    expect(fetches()).toBe(before)

    await leaveFor(60_000)
    await vi.waitFor(() => expect(fetches()).toBe(before + 1))
  })

  it('refreshes Recent after a visit and settings readers after settings writes', async () => {
    let visited = false
    let webdav = false
    fetcher.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path.includes('/visit')) {
        visited = true
        return answer({ count: 1 })
      }
      if (init?.method === 'PATCH') {
        webdav = true
        return answer({ webdav_enabled: true, writer_settings: {} })
      }
      if (path.includes('/views/recents'))
        return answer({ rows: visited ? [node()] : [], next_cursor: null })
      return answer({ webdav_enabled: webdav, writer_settings: {} })
    })
    const recent = observe(() => engine.useQuery(api.drive.views.list, { view: 'recents' }))
    const settings = observe(() => engine.useQuery(api.drive.settings.get))
    await vi.waitFor(() => expect(settings.data?.webdav_enabled).toBe(false))
    await engine.client.mutation(api.drive.nodes.visit, { node: 'budget' })
    await vi.waitFor(() => expect(recent.data?.rows).toHaveLength(1))
    await engine.client.mutation(api.drive.settings.update, { webdav_enabled: true })
    await vi.waitFor(() => expect(settings.data?.webdav_enabled).toBe(true))
  })
})

describe('Mail settings through the shared client', () => {
  it('refreshes the changed account, preserves the other account, and rejects a refused save', async () => {
    const settings = new Map(
      ['alice', 'bob'].map((account) => [
        account,
        {
          create_contacts_after_email_submit: 0,
          destroy_email_after_submit: 0,
          destroy_newsletter_after_submit: 0,
          keep_forwarded_email_in_thread: 0,
          enable_screening: 0,
          block_remote_images: 0,
          on_block_old_mail: 'Ask',
          default_outgoing_email: null,
        },
      ]),
    )
    const reads: string[] = []
    let refuse = false
    fetcher.mockImplementation(async (url, options) => {
      const address = new URL(String(url), 'http://suite.test')
      if (options?.method === 'GET') {
        const account = address.searchParams.get('account') ?? ''
        reads.push(account)
        return answer(settings.get(account))
      }
      if (refuse) return answer({ type: 'PermissionError', message: 'Account is read only' }, 403)
      const input: unknown = JSON.parse(String(options?.body))
      if (
        !input ||
        typeof input !== 'object' ||
        !('account' in input) ||
        typeof input.account !== 'string' ||
        !('changes' in input) ||
        !input.changes ||
        typeof input.changes !== 'object' ||
        !('enable_screening' in input.changes) ||
        (input.changes.enable_screening !== 0 && input.changes.enable_screening !== 1)
      )
        throw new Error('Expected account screening preferences')
      Object.assign(settings.get(input.account)!, input.changes)
      return answer(null)
    })
    const alice = observe(() => engine.useQuery(api.mail.settings.account, { account: 'alice' }))
    const bob = observe(() => engine.useQuery(api.mail.settings.account, { account: 'bob' }))
    await flush()
    await engine.client.mutation(api.mail.settings.updateAccount, {
      account: 'alice',
      changes: { enable_screening: 1 },
    })
    await flush()
    expect(alice.data?.enable_screening).toBe(1)
    expect(bob.data?.enable_screening).toBe(0)
    expect(reads.filter((account) => account === 'alice')).toHaveLength(2)
    expect(reads.filter((account) => account === 'bob')).toHaveLength(1)

    refuse = true
    const save = observe(() => engine.useMutation(api.mail.settings.updateAccount))
    await expect(
      save.run({ account: 'bob', changes: { enable_screening: 1 } }),
    ).rejects.toMatchObject({ type: 'PermissionError' })
    expect(save.isPending).toBe(false)
    expect(save.error?.message).toBe('Account is read only')
    expect(bob.data?.enable_screening).toBe(0)
    expect(reads.filter((account) => account === 'bob')).toHaveLength(1)
    expect(feedback).toHaveBeenCalledTimes(1)
  })

  it('retries a declared POST query and returns POST attachment bytes without JSON decoding', async () => {
    fetcher
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: [] })))
    await expect(
      engine.client.query(api.mail.screening.list, { account: 'alice' }),
    ).resolves.toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockResolvedValueOnce(
      new Response('mail attachment', { headers: { 'Content-Type': 'application/octet-stream' } }),
    )
    const bytes = await engine.client.query(api.mail.attachments.download, {
      account: 'alice',
      blob_id: 'blob',
    })
    expect(bytes).toBeInstanceOf(Blob)
    expect(await bytes.text()).toBe('mail attachment')
  })
})

describe('Drive change events', () => {
  class FakeSocket implements SocketLike {
    private readonly handlers = new Map<string, Set<(payload?: unknown) => void>>()
    on(event: string, handler: (payload?: unknown) => void) {
      this.handlers.set(event, (this.handlers.get(event) ?? new Set()).add(handler))
      return this
    }
    off(event: string, handler?: (payload?: unknown) => void) {
      if (handler) this.handlers.get(event)?.delete(handler)
      return this
    }
    emit() {
      return this
    }
    send(event: string) {
      for (const handler of this.handlers.get(event) ?? []) handler({})
    }
  }
  let socket: FakeSocket
  let live: ReturnType<typeof createApiClient>
  const requested = { children: 0, recents: 0 }
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  beforeEach(() => {
    socket = new FakeSocket()
    requested.children = requested.recents = 0
    fetcher.mockImplementation(async (url) => {
      if (String(url).includes('/views/recents')) requested.recents += 1
      else requested.children += 1
      return answer({ rows: [node()], next_cursor: null })
    })
    live = createApiClient(
      { drive: () => import('@/apps/drive/client/policy').then((module) => module.registration) },
      {
        transport: createTransport({ fetch: fetcher, retryBaseMs: 0 }),
        realtime: createRealtime({ io: () => socket, siteName: 'site', window }),
        feedback,
      },
    )
  })
  afterEach(() => {
    live.dispose()
    setTweaks(['t22-coalesce', 't22-recent-only'], true)
  })

  async function observeListings() {
    const list = observe(() => live.useInfiniteQuery(api.drive.nodes.children, { node: 'root' }))
    const recent = observe(() => live.useQuery(api.drive.views.list, { view: 'recents' }))
    await vi.waitFor(() => expect([list.rows.length, recent.data?.rows.length]).toEqual([1, 1]))
    requested.children = requested.recents = 0
  }

  it('refreshes each observed Drive read once for a burst of changes within 400 ms', async () => {
    await observeListings()

    socket.send('drive:changed')
    await wait(150)
    socket.send('drive:changed')
    socket.send('drive:changed')
    expect(requested).toEqual({ children: 0, recents: 0 })

    await vi.waitFor(() => expect(requested).toEqual({ children: 1, recents: 1 }))
    await wait(500)
    expect(requested).toEqual({ children: 1, recents: 1 })
  })

  it('refreshes at once for every change with t22-coalesce off', async () => {
    setTweaks(['t22-coalesce'], false)
    await observeListings()

    socket.send('drive:changed')
    await vi.waitFor(() => expect(requested).toEqual({ children: 1, recents: 1 }))
    socket.send('drive:changed')
    await vi.waitFor(() => expect(requested).toEqual({ children: 2, recents: 2 }))
  })

  it('refreshes only Recent when a visit is announced, and everything with t22-recent-only off', async () => {
    await observeListings()

    socket.send('drive:recent')
    await vi.waitFor(() => expect(requested.recents).toBe(1))
    await wait(500)
    expect(requested).toEqual({ children: 0, recents: 1 })

    setTweaks(['t22-recent-only'], false)
    socket.send('drive:recent')
    await vi.waitFor(() => expect(requested).toEqual({ children: 1, recents: 2 }))
  })
})
