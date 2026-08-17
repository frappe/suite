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

vi.mock('frappe-ui', () => ({
  frappeRequest: vi.fn(),
  shellScrollContainer: ref(null),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'drive-Recents', params: {} }),
}))
vi.mock('@vueuse/core', () => ({
  onKeyDown: vi.fn(),
  useEventListener: vi.fn(),
  useInfiniteScroll: vi.fn(),
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
  toggleFav: { submit: vi.fn() },
  clearRecent: { submit: vi.fn() },
  move: { submit: vi.fn() },
}))
vi.mock('@/apps/drive/resources/permissions', () => ({
  settings: { fetched: true, data: {}, fetch: vi.fn() },
}))

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
