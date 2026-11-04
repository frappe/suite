import { expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { railHidden } from '@/platform/rail'

import DrawSurface from './DrawSurface.vue'

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
      dispose = vi.fn()
    },
  }
})

it('hides the rail while the drawing is open', () => {
  const app = createApp(DrawSurface, { session: {} as DocumentSession })
  app.mount(document.createElement('div'))

  expect(railHidden.value).toBe(true)

  app.unmount()

  expect(railHidden.value).toBe(false)
})
