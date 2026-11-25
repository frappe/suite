import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, defineComponent, nextTick, reactive } from 'vue'

import { usePaginatedThreads } from '@/apps/mail/composables/usePaginatedThreads'
import type { Thread } from '@/apps/mail/types'
import { draftInList, forgetDraftInList, showDraftInList } from '@/apps/mail/utils/draftsInList'

// The server's side of the list: each read is out until `answer` brings it in with `rows`.
const listOnServer = () => {
  const pending: (() => void)[] = []
  const rows: Thread[] = []
  const query = reactive({
    isFetching: false,
    isFetchingNext: false,
    hasNext: false,
    reads: 0,
    rows,
    refetch: () => {
      query.reads += 1
      query.isFetching = true
      return new Promise<void>((resolve) => pending.push(resolve))
    },
    fetchNext: async () => {},
  })
  const answer = async (rows: Thread[] = query.rows) => {
    query.rows = rows
    query.isFetching = false
    pending.splice(0).forEach((resolve) => resolve())
    await nextTick()
    await Promise.resolve()
  }
  return { query, answer }
}

// Every promise chained on an answer, through.
const settle = () => new Promise((resolve) => setTimeout(resolve))

const mountList = (
  server: ReturnType<typeof listOnServer>,
  { open, onEdgeThread = () => {} }: { open?: string; onEdgeThread?: (id: string) => void } = {},
) => {
  let list!: ReturnType<typeof usePaginatedThreads>
  const app = createApp(
    defineComponent({
      setup() {
        list = usePaginatedThreads({
          query: () => fromPartial(server.query),
          rows: () => server.query.rows,
          openThreadID: () => open,
          onEdgeThread,
        })
        return () => null
      },
    }),
  )
  app.mount(document.createElement('div'))
  return { list, unmount: () => app.unmount() }
}

const row = (messages: string[]) =>
  fromPartial<Thread>({
    id: messages.at(-1)!,
    thread_id: 't1',
    account: 'acc',
    messages: messages.map((id) => ({ id })),
  })

afterEach(() => forgetDraftInList('acc', 't1'))

describe('usePaginatedThreads reads the list again', () => {
  it('reads it once more after the read under way, when asked to refresh meanwhile', async () => {
    const server = listOnServer()
    const { list, unmount } = mountList(server)
    list.refresh()
    expect(server.query.reads).toBe(1)

    // Mail changed elsewhere while the first read was out, twice over.
    list.refresh()
    list.refresh()
    expect(server.query.reads).toBe(1)

    await server.answer()
    expect(server.query.reads).toBe(2)

    await server.answer()
    expect(server.query.reads).toBe(2)
    unmount()
  })

  it('settles a refresh asked meanwhile only once the read owed to it is in', async () => {
    const server = listOnServer()
    const { list, unmount } = mountList(server)
    list.refresh()
    let settled = false
    void list.refresh().then(() => (settled = true))

    // The read under way went out before this refresh was asked: it doesn't answer it.
    await server.answer()
    await settle()
    expect(settled).toBe(false)

    await server.answer()
    await settle()
    expect(settled).toBe(true)
    unmount()
  })

  it('drops the Draft badge of a draft its rows came back without, as when it was sent elsewhere', async () => {
    const server = listOnServer()
    const { list, unmount } = mountList(server)
    showDraftInList('acc', 't1', 'd1', '<p>Hello</p>')

    void list.refetch()
    await server.answer([row(['m1'])])

    expect(draftInList('acc', row(['m1']))).toBeUndefined()
    unmount()
  })
})

describe('usePaginatedThreads at the end of what is loaded', () => {
  it('opens the next thread once the window on its way lands, when Next is asked for meanwhile', async () => {
    const server = listOnServer()
    const thread = (id: string) => fromPartial<Thread>({ thread_id: id, messages: [] })
    server.query.rows = [thread('t1'), thread('t2')]
    server.query.hasNext = true
    let land!: () => void
    server.query.fetchNext = () => {
      server.query.isFetching = true
      return new Promise<void>((resolve) => {
        land = () => {
          server.query.rows = [...server.query.rows, thread('t3')]
          server.query.isFetching = false
          resolve()
        }
      })
    }
    const opened: string[] = []
    // The last loaded thread is open, so the next window is already on its way
    const { list, unmount } = mountList(server, {
      open: 't2',
      onEdgeThread: (id) => opened.push(id),
    })
    await nextTick()

    const next = list.loadMoreThenOpenEdge(1, 'open')
    await nextTick()
    land()
    await next

    expect(opened).toEqual(['t3'])
    unmount()
  })
})
