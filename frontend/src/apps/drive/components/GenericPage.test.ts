import { computed, createApp, defineComponent, h, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// What ListView actually does that matters here: expose a computed derived from
// `folderContents`, which GenericPage reads back via `selectableNames`. The
// stub keeps that contract so the feedback path under test is real.
const listView = vi.hoisted(() => ({
  renders: 0,
  received: [] as unknown[],
}))

vi.mock('./ListView.vue', () => ({
  default: defineComponent({
    props: { folderContents: { type: Object, default: null } },
    setup(props, { expose }) {
      const visibleNames = computed(() =>
        Object.values(props.folderContents ?? {})
          .flat()
          .map((row) => (row as { name: string }).name)
      )
      expose({ visibleNames })
      return () => {
        listView.renders++
        listView.received.push(props.folderContents)
        return h('div')
      }
    },
  }),
}))

const stub = vi.hoisted(() => ({ template: '<div />' }))
vi.mock('./GridView.vue', () => ({ default: defineComponent(stub) }))
vi.mock('./DriveToolBar.vue', () => ({ default: defineComponent(stub) }))
vi.mock('./Navbar.vue', () => ({ default: defineComponent(stub) }))
vi.mock('./NoFilesSection.vue', () => ({ default: defineComponent(stub) }))
vi.mock('./UploadTracker.vue', () => ({ default: defineComponent(stub) }))
vi.mock('./ListDialogs.vue', () => ({ default: defineComponent(stub) }))
vi.mock('./ErrorPage.vue', () => ({ default: defineComponent(stub) }))
vi.mock('./DriveListSkeleton.vue', () => ({ default: defineComponent(stub) }))

const frappeUI = vi.hoisted(() => ({ request: vi.fn(), scrollHost: null as null | { value: unknown } }))
// The shell's scroll container, as a ref the tests can fill in *after* mount —
// which is exactly the cold-mount ordering that used to break infinite scroll.
vi.mock('frappe-ui', () => ({
  frappeRequest: frappeUI.request,
  shellScrollContainer: (frappeUI.scrollHost = ref(null)),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'drive-Recents', params: {} }),
}))
vi.mock('@vueuse/core', () => ({
  onKeyDown: vi.fn(),
  useEventListener: vi.fn(),
}))
vi.mock('@/boot/session', () => ({
  useSessionStore: () => ({ isLoggedIn: false, user: 'tester@example.com' }),
  useCurrentUser: () => ({ systemUser: ref(false) }),
}))
vi.mock('@/apps/drive/data/prefs', () => ({
  view: ref('list'),
  getSortOrder: () => undefined,
  setSortOrder: vi.fn(),
}))
vi.mock('@/apps/drive/data/breadcrumbs', () => ({ pageBreadcrumbs: [] }))
vi.mock('@/apps/drive/data/selection', () => ({
  activeEntity: ref(null),
  startRename: vi.fn(),
}))
vi.mock('@/apps/drive/data/uploads', () => ({ uploads: ref([]) }))
vi.mock('@/apps/drive/utils/files', () => ({
  pasteObj: vi.fn(),
  openEntity: vi.fn(),
  prettyData: (rows: unknown[]) => rows,
  sortEntities: (rows: unknown[]) => rows,
  isVirtual: () => false,
  isManaged: () => true,
  isAttachmentRef: () => false,
}))
vi.mock('@/apps/drive/utils/confirmActions', () => ({
  confirmRestore: vi.fn(),
  confirmRemove: vi.fn(),
  confirmDeleteForever: vi.fn(),
}))
vi.mock('@/apps/drive/utils/download', () => ({ entitiesDownload: vi.fn() }))
vi.mock('@/apps/drive/utils/toasts', () => ({ toast: vi.fn() }))
vi.mock('@/apps/drive/ui/drive/js/utils', () => ({ getFileLink: vi.fn() }))
vi.mock('@/apps/drive/resources/files', () => ({
  PAGE_SIZE: 50,
  formatRows: (rows: unknown[]) => rows,
  toggleFav: { submit: vi.fn() },
  clearRecent: { submit: vi.fn() },
  move: { submit: vi.fn() },
}))
vi.mock('@/apps/drive/resources/permissions', () => ({
  settings: { fetched: true, data: {}, fetch: vi.fn() },
}))

import emitter from '@/apps/drive/emitter'
import GenericPage from './GenericPage.vue'

const entities = [
  { name: 'a', file_name: 'A', modified: '2026-08-10 10:00:00' },
  { name: 'b', file_name: 'B', modified: '2026-08-09 10:00:00' },
]

function mountPage(grouper: (rows: unknown[]) => unknown) {
  const getEntities = {
    data: entities,
    error: null,
    loading: false,
    paginated: false,
    params: {},
    url: 'suite.drive.api.list.recents',
    fetch: vi.fn(),
    setData: vi.fn(),
  }
  const errors: string[] = []
  const app = createApp(
    defineComponent({
      setup: () => () => h(GenericPage, { grouper, getEntities, showSort: false }),
    })
  )
  app.config.errorHandler = (err) => errors.push(String(err))
  app.config.warnHandler = (msg) => errors.push(msg)
  app.provide('socket', { on: vi.fn() })
  app.mount(document.createElement('div'))
  return { app, errors }
}

// Recents' groupByTime — the shape that matters is a fresh object per call.
const freshObjectGrouper = (rows: unknown[]) => ({
  Today: [...rows],
  'Earlier this week': [],
})

describe('GenericPage grouped rows', () => {
  beforeEach(() => {
    frappeUI.scrollHost!.value = null
    listView.renders = 0
    listView.received = []
    window.__ = (message: string) => message
  })

  it('keeps one folderContents identity when the grouper builds a fresh object', async () => {
    // Regression: an inline `grouper(rows)` in the template handed ListView a
    // new prop object every render. ListView's exposed `visibleNames` reads
    // that prop and GenericPage reads it back, so each render retriggered
    // itself — an unbounded loop that froze the Recents tab.
    const { app, errors } = mountPage(freshObjectGrouper)
    await nextTick()
    await nextTick()

    expect(errors.filter((e) => e.includes('Maximum recursive updates'))).toEqual([])
    expect(new Set(listView.received).size).toBe(1)
    expect(listView.renders).toBeLessThan(5)
    app.unmount()
  })

  it('still passes the grouped shape through to the list', async () => {
    const { app } = mountPage(freshObjectGrouper)
    await nextTick()

    expect(listView.received.at(-1)).toEqual({
      Today: entities,
      'Earlier this week': [],
    })
    app.unmount()
  })
})

/**
 * The server dedupes and permission-filters *after* LIMIT/OFFSET, so a full
 * SQL window can answer with fewer rows than PAGE_SIZE while rows still remain.
 * End-of-list therefore has to come from the server's `has_next`, never from the
 * row count.
 *
 * Separately, the shell registers its scroll container a tick *after* this
 * component sets up, so the binding has to survive the container arriving late.
 */
function makeHost({ scrollHeight = 3000, clientHeight = 800, scrollTop = 0 } = {}) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true })
  return el
}

function mountPaginated(firstPage: {
  rows: unknown[]
  has_next: boolean
  next_start?: number
}) {
  const getEntities = {
    data: firstPage.rows,
    error: null,
    loading: false,
    paginated: true,
    params: {},
    url: 'suite.drive.api.list.files',
    // Mirrors frappe-ui: onSuccess receives the untransformed payload.
    fetch: vi.fn((_params, options) => options?.onSuccess?.(firstPage)),
    setData: vi.fn(),
  }
  const app = createApp(
    defineComponent({
      setup: () => () =>
        h(GenericPage, {
          grouper: (rows: unknown[]) => ({ All: [...rows] }),
          getEntities,
          showSort: false,
        }),
    })
  )
  app.provide('socket', { on: vi.fn() })
  app.mount(document.createElement('div'))
  return { app, getEntities }
}

const scrollTo = async (el: HTMLElement, top: number) => {
  ;(el as unknown as { scrollTop: number }).scrollTop = top
  el.dispatchEvent(new Event('scroll'))
  await nextTick()
  await nextTick()
}

describe('GenericPage pagination', () => {
  beforeEach(() => {
    frappeUI.scrollHost!.value = null
    frappeUI.request.mockReset()
    frappeUI.request.mockResolvedValue({
      message: {
        rows: [{ name: 'c', file_name: 'C' }],
        has_next: false,
        next_start: 90,
      },
    })
    window.__ = (message: string) => message
  })

  it('asks the server for the paginated envelope', async () => {
    const { app, getEntities } = mountPaginated({ rows: [], has_next: false })
    await nextTick()

    expect(getEntities.fetch.mock.calls[0][0]).toMatchObject({
      start: 0,
      limit: 50,
      paginated: 1,
    })
    app.unmount()
  })

  it('keeps paging when a short page still reports more rows', async () => {
    // Two rows is far short of PAGE_SIZE (50), which the old
    // `page.length >= PAGE_SIZE` check read as end-of-list — permanently
    // freezing infinite scroll and stranding the rest of the folder.
    const el = makeHost()
    frappeUI.scrollHost!.value = el
    const { app, getEntities } = mountPaginated({
      rows: [{ name: 'a', file_name: 'A' }, { name: 'b', file_name: 'B' }],
      has_next: true,
    })
    await nextTick()

    await scrollTo(el, 2300) // 3000 - 2300 - 800 = -100, within 200px of bottom

    expect(frappeUI.request).toHaveBeenCalledTimes(1)
    expect(frappeUI.request.mock.calls[0][0].params).toMatchObject({
      start: 50,
      limit: 50,
      paginated: 1,
    })
    expect(getEntities.setData).toHaveBeenCalledWith([
      ...getEntities.data,
      { name: 'c', file_name: 'C' },
    ])
    app.unmount()
  })

  it('binds to a scroll container that only registers after mount', async () => {
    // Regression. `shellScrollContainer` is a module-level ref the app
    // shell fills in, and on a cold mount it does so a tick after this component
    // sets up. Binding once at setup caught `null` and never re-armed, so the
    // list loaded page 1 and then never paginated however far you scrolled.
    const { app } = mountPaginated({
      rows: [{ name: 'a', file_name: 'A' }],
      has_next: true,
    })
    await nextTick()

    const el = makeHost()
    frappeUI.scrollHost!.value = el // the shell registers, late
    await nextTick()

    await scrollTo(el, 2300)

    expect(frappeUI.request).toHaveBeenCalledTimes(1)
    expect(frappeUI.request.mock.calls[0][0].params).toMatchObject({ start: 50 })
    app.unmount()
  })

  it('does not page while still far from the bottom', async () => {
    const el = makeHost()
    frappeUI.scrollHost!.value = el
    const { app } = mountPaginated({
      rows: [{ name: 'a', file_name: 'A' }],
      has_next: true,
    })
    await nextTick()

    await scrollTo(el, 100)

    expect(frappeUI.request).not.toHaveBeenCalled()
    app.unmount()
  })

  it('stops when the server reports no more rows', async () => {
    const el = makeHost()
    frappeUI.scrollHost!.value = el
    const { app } = mountPaginated({
      rows: [{ name: 'a', file_name: 'A' }],
      has_next: false,
    })
    await nextTick()

    await scrollTo(el, 2300)

    expect(frappeUI.request).not.toHaveBeenCalled()
    app.unmount()
  })

  it('discards a page that lands after the query moved on', async () => {
    // Greptile P1: search/sort/refresh resets pagination while a loadMore is
    // still awaiting. Appending the stale rows mixes two result sets and the
    // stale cursor overwrites the reset, skipping a page of the new query.
    const el = makeHost()
    frappeUI.scrollHost!.value = el
    const { app, getEntities } = mountPaginated({
      rows: [{ name: 'a', file_name: 'A' }],
      has_next: true,
      next_start: 50,
    })
    await nextTick()

    let release: (v: unknown) => void = () => {}
    frappeUI.request.mockReturnValue(new Promise((r) => (release = r)))
    await scrollTo(el, 2300)
    expect(frappeUI.request).toHaveBeenCalledTimes(1)

    getEntities.setData.mockClear()
    ;(el as unknown as { scrollTop: number }).scrollTop = 0
    emitter.emit('refresh') // a new query starts under the in-flight page

    release({ message: { rows: [{ name: 'stale' }], has_next: true, next_start: 999 } })
    await nextTick()
    await nextTick()

    expect(getEntities.setData).not.toHaveBeenCalled()
    app.unmount()
  })

  it('discards a page that lands after unmount', async () => {
    const el = makeHost()
    frappeUI.scrollHost!.value = el
    const { app, getEntities } = mountPaginated({
      rows: [{ name: 'a', file_name: 'A' }],
      has_next: true,
      next_start: 50,
    })
    await nextTick()

    let release: (v: unknown) => void = () => {}
    frappeUI.request.mockReturnValue(new Promise((r) => (release = r)))
    await scrollTo(el, 2300)
    app.unmount()

    release({ message: { rows: [{ name: 'stale' }], has_next: false, next_start: 51 } })
    await nextTick()

    expect(getEntities.setData).not.toHaveBeenCalled()
  })

  it('keeps paging after a loaded page still leaves the viewport near the bottom', async () => {
    const el = makeHost({ scrollHeight: 3000, clientHeight: 800 })
    frappeUI.scrollHost!.value = el
    const { app } = mountPaginated({
      rows: [{ name: 'a', file_name: 'A' }],
      has_next: true,
      next_start: 50,
    })
    await nextTick()

    frappeUI.request
      .mockResolvedValueOnce({
        message: { rows: [{ name: 'b', file_name: 'B' }], has_next: true, next_start: 51 },
      })
      .mockResolvedValueOnce({
        message: { rows: [{ name: 'c', file_name: 'C' }], has_next: false, next_start: 52 },
      })

    await scrollTo(el, 2100)
    await nextTick()
    await nextTick()

    expect(frappeUI.request).toHaveBeenCalledTimes(2)
    app.unmount()
  })

  it('tops up a page too short to scroll', async () => {
    // No scroll event can ever follow a page that does not overflow its
    // container, so the fill has to be driven from the data arriving.
    const el = makeHost({ scrollHeight: 700, clientHeight: 800 })
    frappeUI.scrollHost!.value = el
    const { app } = mountPaginated({
      rows: [{ name: 'a', file_name: 'A' }],
      has_next: true,
    })
    await nextTick()
    await nextTick()
    await nextTick()

    expect(frappeUI.request).toHaveBeenCalled()
    expect(frappeUI.request.mock.calls[0][0].params).toMatchObject({ start: 50 })
    app.unmount()
  })
})
