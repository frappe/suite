import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App, type Ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { railHidden } from '@/platform/rail'

import DrawSurface from './DrawSurface.vue'

const drawing = vi.hoisted(() => ({
  opened: null as { readable: Ref<boolean>; loadError: Ref<boolean> } | null,
}))

vi.mock('frappe-ui', () => ({ Button: { render: () => null } }))
vi.mock('@/apps/drive', () => ({ useDriveDocumentCreation: () => ({}), driveNodeRoute: vi.fn() }))
vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))
vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
  useRouter: vi.fn(),
}))
vi.mock('../App.vue', () => ({ default: { render: () => null } }))
vi.mock('../canvas/persistence', async () => {
  const { ref } = await import('vue')
  return {
    DRAWING_PERSISTENCE: Symbol('persistence'),
    DrawingPersistence: class {
      dirty = ref(false)
      saving = ref(false)
      error = ref('')
      conflict = ref(false)
      loadError = ref(false)
      editable = ref(true)
      recoveryAvailable = ref(true)
      recoveryAllowed = ref(true)
      drawingLoading = ref(false)
      readable = ref(true)
      saveDrawing = vi.fn()
      retainRecovery = vi.fn()
      dispose = vi.fn()
      constructor() {
        drawing.opened = this
      }
    },
  }
})

let app: App | null = null

function openDrawing() {
  app = createApp(DrawSurface, { session: {} as DocumentSession })
  app.mount(document.createElement('div'))
  return drawing.opened!
}

afterEach(() => {
  app?.unmount()
  app = null
})

it('hides the rail while the drawing is open, and gives it back on leaving', () => {
  openDrawing()
  expect(railHidden.value).toBe(true)

  app?.unmount()
  app = null
  expect(railHidden.value).toBe(false)
})

it('brings the rail back when the drawing fails to load', async () => {
  const opened = openDrawing()
  expect(railHidden.value).toBe(true)

  opened.loadError.value = true
  await nextTick()

  expect(railHidden.value).toBe(false)
})

it('brings the rail back when read access goes', async () => {
  const opened = openDrawing()
  expect(railHidden.value).toBe(true)

  opened.readable.value = false
  await nextTick()

  expect(railHidden.value).toBe(false)
})
