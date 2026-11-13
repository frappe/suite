import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'
import { ref } from 'vue'

interface OfflineCopyFixtureState {
  shell: () => Response
  visitedCache: FakeCache | null
}

export const presentationDoc = ref<Record<string, unknown> | null>({ is_composite: 0 })
export const presentationId = ref<string | null>('p1')
export const viewOnly = ref(false)
export const slides = ref<unknown[]>([])
const loadedChunks: string[] = []

vi.mock('@/apps/slides/stores/presentation', () => ({ presentationDoc, presentationId, viewOnly }))
vi.mock('@/apps/slides/stores/slide', () => ({ slides }))
vi.mock('@/apps/slides/utils/mediaUploads', async () => {
  const { isMediaNodeId, mediaNodeUrl } = await import('@/apps/slides/stores/documentMedia')
  function getAttachmentUrl(src: string) {
    if (isMediaNodeId(src)) {
      return mediaNodeUrl(src)
    }

    return `/private${src}?slides_media=1`
  }

  return { getAttachmentUrl }
})
vi.mock('@/apps/slides/utils/loadedAssets', () => ({ loadedAssets: () => loadedChunks }))
export let slideshowChunkLoads = 0
vi.mock('@/apps/slides/pages/Slideshow.vue', () => {
  slideshowChunkLoads += 1
  return { default: {} }
})

export const statusOf = (id: string) => {
  refreshOfflineStatus(id)
  return offlineCopyStatus.value
}

export function recordOf(id: string) {
  return JSON.parse(localStorage.getItem(`slides-offline-copy:${id}`)!)
}

// the pictures the record lists; the shell, API and asset keys have tests of their own
export const recordedKeys = (id: string) =>
  recordOf(id).keys.filter((key: string) => key.startsWith('/private/files/'))

export class FakeCache {
  store = new Map<string, Response>()
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }))
  }
  async put(key: string, response: Response) {
    this.store.set(new URL(key, 'http://localhost').href, response)
  }
  async delete(key: string) {
    return this.store.delete(new URL(key, 'http://localhost').href)
  }
  has(key: string) {
    return this.store.has(new URL(key, 'http://localhost').href)
  }
  async match(key: string) {
    return this.store.get(new URL(key, 'http://localhost').href)?.clone()
  }
  text(key: string) {
    return this.store.get(new URL(key, 'http://localhost').href)!.clone().text()
  }
}

export let cache: FakeCache
export const deletedCaches: string[] = []
export let responses: Record<string, () => Response | Error>
export const state: OfflineCopyFixtureState = {
  shell: () => shellResponse(),
  visitedCache: null,
}
export const fetched: string[] = []
export const startupFetched: string[] = []

export const SHELL_HTML = `<html><head>
  <script type="module" src="/assets/suite/frontend/assets/index-a1.js"></script>
  <link rel="stylesheet" href="/assets/suite/frontend/assets/index-c3.css">
</head><body></body></html>`

export function shellResponse(
  headers: Record<string, string> = {},
  status = 200,
  html = SHELL_HTML,
) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Suite-Build': '100', ...headers },
  })
}

function json(status = 200) {
  return new Response('{"data":{}}', { status, headers: { 'Content-Type': 'application/json' } })
}

export const STARTUP_API = [
  '/api/method/suite.slides.doctype.presentation.presentation.get_public_presentation?name=p1',
  '/api/suite/drive/nodes/n1?expand=access%2Cpreview%2Cbreadcrumbs',
  '/api/suite/drive/nodes/n1/media',
]
export const ENTRY_ASSETS = [
  '/assets/suite/frontend/assets/index-a1.js',
  '/assets/suite/frontend/assets/index-c3.css',
]
export const LAZY_CHUNK = '/assets/suite/frontend/assets/SlidesSurface-d4.js'
// read from the stylesheet, so a font added there is one a pin must store
export const DECLARED_FONTS = [
  ...readFileSync(resolve(__dirname, '../styles/fonts.css'), 'utf8').matchAll(/url\('([^']+)'\)/g),
].map(([, url]) => url)

export const image = (bytes = 10) =>
  new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes) },
  })

export const slidesWith = (...srcs: string[][]) =>
  srcs.map((list) => ({ elements: list.map((src) => ({ type: 'image', src })) }))

beforeEach(() => {
  cache = new FakeCache()
  state.visitedCache = null
  deletedCaches.length = 0
  fetched.length = 0
  startupFetched.length = 0
  loadedChunks.splice(0, loadedChunks.length, LAZY_CHUNK)
  state.shell = () => shellResponse()
  vi.stubGlobal('__SUITE_BUILD__', '100')
  localStorage.clear()
  responses = {}
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      if (name === 'slides-api') {
        return new FakeCache()
      }

      if (name !== 'slides-visited') {
        return cache
      }

      state.visitedCache ??= new FakeCache()
      return state.visitedCache
    },
    has: async (name: string) => name !== 'slides-visited' || state.visitedCache !== null,
    delete: async (name: string) => {
      deletedCaches.push(name)
      if (name === 'slides-visited') {
        state.visitedCache = null
      }

      return true
    },
  })
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    serviceWorker: { controller: {}, addEventListener: () => {} },
  })
  presentationDoc.value = { node: 'n1', is_composite: 0, modified: '2026-08-17 10:00:00' }
  presentationId.value = 'p1'
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.includes('get_templates')) {
      return json()
    }

    if (url.startsWith('/d/')) {
      startupFetched.push(url)

      return state.shell()
    }

    if (url.startsWith('/api/')) {
      startupFetched.push(url)

      return json()
    }

    if (url.startsWith('/assets/')) {
      startupFetched.push(url)

      return new Response('chunk', { headers: { 'Content-Type': 'text/javascript' } })
    }
    fetched.push(url)
    const make = responses[url]
    if (!make) return new Response('', { status: 404 })
    const out = make()
    if (out instanceof Error) throw out
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    return out
  })
  slides.value = slidesWith(['/files/a.png'], ['/files/b.png'])
  responses['/private/files/a.png?slides_media=1'] = () => image(10)
  responses['/private/files/b.png?slides_media=1'] = () => image(20)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const { refreshOfflineStatus, offlineCopyStatus } = await import('./offlineCopy')
