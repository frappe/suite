import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { rooms, signedIn, stored } from './writer-surface-fakes'
import {
  liveRoom,
  oneVersion,
  openedSurface,
  resetSurface,
  type Comments,
} from './writer-surface-fixtures'

vi.hoisted(() => {
  vi.stubGlobal('__SUITE_BUILD__', '100')
  vi.stubEnv('DEV', false)
})

vi.mock('frappe-ui', async () => (await import('./writer-surface-fakes')).fakeFrappeUi())
vi.mock('@/apps/drive', async () => (await import('./writer-surface-fakes')).fakeDrive())
vi.mock('@/platform/session', async (importOriginal) => {
  const { fakeSession } = await import('./writer-surface-fakes')
  return fakeSession(await importOriginal<typeof import('@/platform/session')>())
})
vi.mock('@/apps/writer/components/CoreEditor.vue', async () =>
  (await import('./writer-surface-fakes')).fakeCoreEditor(),
)
vi.mock('@/apps/writer/collab', () => ({
  BODY_FIELD: 'default',
}))
vi.mock('@/platform/collab', async () =>
  (await import('./writer-surface-fakes')).fakeCollabPlatform(),
)
vi.mock('./writerDocument', async (importOriginal) => {
  const { fakeWriterDocument } = await import('./writer-surface-fakes')
  return fakeWriterDocument(await importOriginal<typeof import('./writerDocument')>())
})
vi.mock('@/apps/writer/components/CollabTextEditor.vue', async (importOriginal) => {
  const { fakeCollabTextEditor } = await import('./writer-surface-fakes')
  const real =
    await importOriginal<typeof import('@/apps/writer/components/CollabTextEditor.vue')>()
  return fakeCollabTextEditor(real)
})
vi.mock('@/apps/writer/components/UsersBar.vue', () => ({ default: { render: () => null } }))
vi.mock('./WriterDocumentMenu.vue', async () =>
  (await import('./writer-surface-fakes')).fakeDocumentMenu(),
)
vi.mock('@/apps/writer/composables/useUsers', async (importOriginal) => {
  const { fakeUsers } = await import('./writer-surface-fakes')
  return fakeUsers(await importOriginal<typeof import('@/apps/writer/composables/useUsers')>())
})
vi.mock('./VersionPreview.vue', async () =>
  (await import('./writer-surface-fakes')).fakeVersionPreview(),
)

afterEach(resetSurface)

const { watchBuild } = await import('@/platform/build')

// The server names `minBuilds` on a response, as it does on every request
async function serverMinBuilds(minBuilds: Record<string, string>) {
  const headers = { 'X-Suite-Min-Builds': JSON.stringify(minBuilds) }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { headers })),
  )
  watchBuild()
  await window.fetch('/api/method/ping')
}

// A live room that can be asked to pull, as going offline or online does
function pullingRoom() {
  return Object.assign(liveRoom(), { pull: async () => {} })
}

function saveStatus(root: Element) {
  return root.querySelector('[data-save-state]')!.textContent
}

describe('what a reader sees of a document', () => {
  it('shows a signed-out reader of a public document the document only', async () => {
    signedIn.isOn = false
    const list = vi.fn(async () => ({ threads: [] }))
    const reader = await openedSurface(
      oneVersion,
      '/d/node-1',
      { list } as unknown as Comments,
      ref({ role: 10 }),
    )

    expect(reader.querySelector('[data-open-comments], [data-open-versions]')).toBeNull()
    expect(reader.querySelector('.writer-hides-comments')).not.toBeNull()
    expect(list).not.toHaveBeenCalled()
    document.body.innerHTML = ''

    const commenter = await openedSurface(
      oneVersion,
      '/d/node-1',
      { list } as unknown as Comments,
      ref({ role: 20 }),
    )
    expect(commenter.querySelector('[data-open-comments]')).not.toBeNull()
    expect(commenter.querySelector('[data-open-versions]')).toBeNull()
    expect(list).toHaveBeenCalled()
  })
})

describe('the save status', () => {
  afterEach(() => serverMinBuilds({}))

  it('stays quiet about saves that go through, and warns everyone of one that failed', async () => {
    await serverMinBuilds({ writer: '100' })
    const room = pullingRoom()
    const editorView = await openedSurface()
    expect(saveStatus(editorView)).toBe('')
    document.body.innerHTML = ''

    room.status = { ...room.status, saveState: 'unsaved', unsentCount: 650 }
    const savingView = await openedSurface()
    expect(saveStatus(savingView)).toBe('')
    document.body.innerHTML = ''

    pullingRoom().status.saveState = 'failed'
    const readerView = await openedSurface(oneVersion, '/d/node-1', undefined, ref({ role: 10 }))
    expect(saveStatus(readerView)).toBe('failed')
  })

  it('says when the document was last edited, and that this tab has just edited it', async () => {
    await serverMinBuilds({ writer: '100' })
    stored.contentModified = new Date(Date.now() - 3 * 60 * 60_000).toISOString()
    const listeners: (() => void)[] = []
    const room = Object.assign(pullingRoom(), {
      onChange: (listener: () => void) => {
        listeners.push(listener)
        return () => {}
      },
    })
    const root = await openedSurface()
    expect(root.textContent).toContain('Edited 3h ago')

    room.status = { ...room.status, saveState: 'unsaved' }
    listeners.forEach((listener) => listener())
    await vi.waitFor(() => expect(root.textContent).toContain('Edited just now'))
  })

  it('says that edits will sync while offline', async () => {
    await serverMinBuilds({ writer: '100' })
    const room = pullingRoom()
    room.status = { ...room.status, saveState: 'unsaved', unsentCount: 650 }
    const root = await openedSurface()

    window.dispatchEvent(new Event('offline'))
    await nextTick()

    expect(root.textContent).toContain('Changes will sync')
    window.dispatchEvent(new Event('online'))
  })

  it('does not call an editor view only while the document opens', async () => {
    await serverMinBuilds({ writer: '100' })
    pullingRoom()
    let open = () => {}
    rooms.held = new Promise<void>((resolve) => {
      open = resolve
    })
    const opened = openedSurface()
    await vi.waitFor(() => expect(document.querySelector('[data-save-state]')).not.toBeNull())
    expect(document.querySelector('[data-view-only]')).toBeNull()

    open()
    await opened
    expect(document.querySelector('[data-view-only]')).toBeNull()
    document.body.innerHTML = ''

    rooms.held = null
    pullingRoom()
    await openedSurface(oneVersion, '/d/node-1', undefined, ref({ role: 10 }))
    expect(document.querySelector('[data-view-only]')).not.toBeNull()
  })

  it('says nothing while another tab’s save holds the document for a moment, and Saving paused for a real pause', async () => {
    await serverMinBuilds({ writer: '100' })
    const listeners: (() => void)[] = []
    const room = Object.assign(pullingRoom(), {
      onChange: (listener: () => void) => {
        listeners.push(listener)
        return () => {}
      },
    })
    room.status = { ...room.status, saveState: 'unsaved', pauseReason: 'busy' }
    const root = await openedSurface()

    const whileBusy = root.textContent?.includes('Saving paused')
    room.status = { ...room.status, pauseReason: 'suspect' }
    listeners.forEach((listener) => listener())
    await vi.waitFor(() => expect(root.textContent).toContain('Saving paused'))

    expect(whileBusy).toBe(false)
  })
})
