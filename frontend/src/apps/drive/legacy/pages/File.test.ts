import { createApp, defineComponent, h, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fileFetch: vi.fn(),
  routerPush: vi.fn(),
  trackVisit: vi.fn(),
  setActiveEntity: vi.fn(),
  setCrumbEntity: vi.fn(),
  updateURLSlug: vi.fn(),
}))

vi.mock('frappe-ui', () => ({
  Button: defineComponent({ template: '<button />' }),
  createResource: (options: { url: string }) =>
    options.url.endsWith('track_visit')
      ? { submit: mocks.trackVisit }
      : { data: null, error: null, loading: false, fetch: mocks.fileFetch },
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.routerPush }) }))
vi.mock('@vueuse/core', () => ({ onKeyStroke: vi.fn() }))
vi.mock('~icons/lucide/scan', () => ({ default: defineComponent({ template: '<span />' }) }))
vi.mock('@/apps/drive/data/selection', () => ({ setActiveEntity: mocks.setActiveEntity }))
vi.mock('@/apps/drive/data/breadcrumbs', () => ({
  pageBreadcrumbs: [],
  setCrumbEntity: mocks.setCrumbEntity,
  clearCrumbEntity: vi.fn(),
}))
vi.mock('@/apps/drive/data/currentFolder', () => ({ currentFolder: { value: { entities: [] } } }))
vi.mock('@/apps/drive/utils/files', () => ({
  prettyData: (entities: unknown[]) => entities,
  enterFullScreen: vi.fn(),
  updateURLSlug: mocks.updateURLSlug,
  isWriterDocument: () => false,
  hasHostedContent: () => false,
}))

vi.mock('@/apps/drive/components/Navbar.vue', () => ({
  default: defineComponent({ template: '<div />' }),
}))
vi.mock('@/apps/drive/components/FileRender.vue', () => ({
  default: defineComponent({ template: '<div />' }),
}))
vi.mock('@/apps/drive/components/FileTypePreview/FilePreviewSkeleton.vue', () => ({
  default: defineComponent({ template: '<div />' }),
}))
vi.mock('@/apps/drive/components/ErrorPage.vue', () => ({
  default: defineComponent({ template: '<div />' }),
}))

import FilePage from './File.vue'

function mountFile(entityName: string) {
  const root = document.createElement('div')
  const app = createApp(
    defineComponent({
      setup: () => () => h(FilePage, { entityName, slug: entityName }),
    }),
  )
  app.mount(root)
  return { app }
}

describe('Drive File page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches the route entity on initial mount', async () => {
    const { app } = mountFile('file-a')
    await nextTick()

    expect(mocks.fileFetch).toHaveBeenCalledOnce()
    expect(mocks.fileFetch).toHaveBeenCalledWith({ entity_name: 'file-a' })
    expect(mocks.routerPush).toHaveBeenCalledWith({ params: { entityName: 'file-a' } })
    app.unmount()
  })
})
