import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import * as Y from 'yjs'

import { convertLegacy } from '@/apps/slides/collab/conversion'
import type { CollabRoom, CollabSession, openCollabRoom } from '@/platform/collab'
import { translationPlugin } from '@/platform/translation'

import ConvertedDeck from './ConvertedDeck.vue'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const session = {} as CollabSession
let cleanup: (() => void) | null = null

afterEach(() => {
  cleanup?.()
  cleanup = null
})

function elementsSaying(text: string) {
  return [{ id: `box-${text}`, type: 'text', content: `<p>${text}</p>` }]
}

function liveRoom() {
  const slides = [
    { id: 'one', elements: elementsSaying('first') },
    { id: 'two', elements: elementsSaying('second') },
  ]
  const answer = convertLegacy({ slides }, 4 * 1024 * 1024)
  if (answer.kind !== 'converted') {
    throw new Error(JSON.stringify(answer))
  }

  const doc = new Y.Doc()
  Y.applyUpdate(doc, answer.state)

  return { doc, close: vi.fn(async () => {}) } as unknown as CollabRoom
}

async function mounted(open: typeof openCollabRoom) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(ConvertedDeck, { session, open }) })
  app.use(translationPlugin).mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }

  await vi.waitFor(() => expect(root.querySelector('nav, p')).not.toBeNull())
  await nextTick()

  return { root, unmount: () => cleanup?.() }
}

function button(root: Element, label: string) {
  return root.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
}

describe('a converted deck, read-only', () => {
  it('walks every slide with next and previous, and stops at both ends', async () => {
    const room = liveRoom()
    const { root } = await mounted(async () => ({ state: 'live', room }))

    expect(root.textContent).toContain('first')
    expect(root.textContent).toContain('1 of 2')
    expect(button(root, 'Previous slide').disabled).toBe(true)

    button(root, 'Next slide').click()
    await nextTick()
    expect(root.textContent).toContain('second')
    expect(root.textContent).not.toContain('first')
    expect(button(root, 'Next slide').disabled).toBe(true)

    button(root, 'Previous slide').click()
    await nextTick()
    expect(root.textContent).toContain('first')
  })

  it('offers no way to edit and writes nothing to the deck', async () => {
    const room = liveRoom()
    const writes = vi.fn()
    room.doc.on('update', writes)
    const { root } = await mounted(async () => ({ state: 'live', room }))

    button(root, 'Next slide').click()
    await nextTick()

    expect(root.querySelector('[contenteditable="true"]')).toBeNull()
    expect(writes).not.toHaveBeenCalled()
  })

  it('leaves the room when it goes away', async () => {
    const room = liveRoom()
    const { unmount } = await mounted(async () => ({ state: 'live', room }))

    unmount()

    expect(room.close).toHaveBeenCalledOnce()
  })

  it('says so when the room will not open, and never draws the old rows', async () => {
    const { root } = await mounted(async () => ({ state: 'unconverted' }))

    expect(root.textContent).toContain('Could not open this presentation.')
    expect(root.querySelector('nav')).toBeNull()
  })
})
