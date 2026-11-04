import { beforeEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { railHidden } from '@/platform/rail'

import DrawSurface from './DrawSurface.vue'

const drawing = vi.hoisted(() => ({ readable: true, loadError: false }))

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
      loadError = ref(drawing.loadError)
      editable = ref(true)
      recoveryAvailable = ref(true)
      recoveryAllowed = ref(true)
      drawingLoading = ref(false)
      readable = ref(drawing.readable)
      saveDrawing = vi.fn()
      dispose = vi.fn()
    },
  }
})

beforeEach(() => Object.assign(drawing, { readable: true, loadError: false }))

function railHiddenWhileOpen() {
  const app = createApp(DrawSurface, { session: {} as DocumentSession })
  app.mount(document.createElement('div'))
  const isHidden = railHidden.value
  app.unmount()
  return isHidden
}

it('hides the rail while the drawing is open', () => {
  expect(railHiddenWhileOpen()).toBe(true)
  expect(railHidden.value).toBe(false)
})

it('keeps the rail on the load-error page', () => {
  drawing.loadError = true

  expect(railHiddenWhileOpen()).toBe(false)
})

it('keeps the rail on the no-permission page', () => {
  drawing.readable = false

  expect(railHiddenWhileOpen()).toBe(false)
})
