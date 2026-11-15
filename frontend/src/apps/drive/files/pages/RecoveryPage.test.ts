import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'

import { DOCUMENT_TYPES_KEY, type DocumentTypeDefinition } from '@/platform/contracts'
import { translationPlugin } from '@/platform/translation'

const quiet = () => defineComponent({ render: () => null })
vi.mock('./FilesPanel.vue', () => ({ default: quiet() }))
vi.mock('@/platform/area-sidebar', () => ({ AreaSidebar: quiet() }))

const { default: RecoveryPage } = await import('./RecoveryPage.vue')

const EMPTY = 'No recovery copies'

// A type's section that lists `count` copies once its read is let through
function typeKeeping(key: string) {
  let finishRead!: (count: number) => void
  const read = new Promise<number>((resolve) => {
    finishRead = resolve
  })
  const section = defineComponent({
    emits: ['counted'],
    setup(_props, { emit }) {
      void read.then((count) => emit('counted', count))
      return () => h('section', `${key} section`)
    },
  })
  const type: DocumentTypeDefinition = {
    key,
    contentDoctype: key,
    newLabel: () => key,
    icon: quiet(),
    loadSurface: async () => quiet(),
    loadUnsavedWork: async () => section,
  }
  return { type, finishRead }
}

let app: App | null = null

async function openedPage(types: DocumentTypeDefinition[]) {
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(RecoveryPage).use(translationPlugin)
  app.provide(DOCUMENT_TYPES_KEY, types)
  app.mount(root)
  await vi.waitFor(() => expect(root.querySelectorAll('section')).toHaveLength(types.length))
  return root
}

// Lets a section's read and the page's redraw settle
async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('Recovery copies page', () => {
  it('says once that there are no copies when no type keeps any', async () => {
    const writer = typeKeeping('writer')
    const slides = typeKeeping('slides')
    const root = await openedPage([writer.type, slides.type])

    writer.finishRead(0)
    slides.finishRead(0)

    await vi.waitFor(() => expect(root.textContent).toContain(EMPTY))
    expect(root.textContent!.split(EMPTY)).toHaveLength(2)
  })

  it('says nothing about no copies when one type lists some', async () => {
    const writer = typeKeeping('writer')
    const slides = typeKeeping('slides')
    const root = await openedPage([writer.type, slides.type])

    writer.finishRead(0)
    slides.finishRead(2)
    await settled()

    expect(root.textContent).not.toContain(EMPTY)
  })

  it('waits for every type before saying there are none', async () => {
    const writer = typeKeeping('writer')
    const slides = typeKeeping('slides')
    const root = await openedPage([writer.type, slides.type])

    writer.finishRead(0)
    await settled()

    expect(root.textContent).not.toContain(EMPTY)
  })
})
