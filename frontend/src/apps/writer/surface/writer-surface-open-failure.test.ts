import { CollabOpenError } from '@suite/collab-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { api } from '@/api'
import { railHidden } from '@/platform/rail'
import { TransportError } from '@/platform/transport'

import { rooms } from './writer-surface-fakes'
import { buttonLabelled, liveRoom, mountedSurface, resetSurface } from './writer-surface-fixtures'

vi.hoisted(() => {
  vi.stubGlobal('__SUITE_BUILD__', '100')
  vi.stubEnv('DEV', false)
})

const query = vi.hoisted(() => vi.fn())
vi.mock('@/api', async (original) => {
  const real = await original<typeof import('@/api')>()
  return { ...real, client: { ...real.client, query } }
})
vi.mock('frappe-ui', async () => (await import('./writer-surface-fakes')).fakeFrappeUi())
vi.mock('@/apps/drive', async (importOriginal) => {
  const { fakeDrive } = await import('./writer-surface-fakes')
  return fakeDrive(await importOriginal<typeof import('@/apps/drive')>())
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
vi.mock('@/apps/writer/components/CollabTextEditor.vue', async (importOriginal) => {
  const { fakeCollabTextEditor } = await import('./writer-surface-fakes')
  const real =
    await importOriginal<typeof import('@/apps/writer/components/CollabTextEditor.vue')>()
  return fakeCollabTextEditor(real)
})
vi.mock('@/platform/collab/UsersBar.vue', () => ({ default: { render: () => null } }))
vi.mock('./WriterDocumentMenu.vue', async () =>
  (await import('./writer-surface-fakes')).fakeDocumentMenu(),
)
vi.mock('@/platform/collab/names', async (importOriginal) => {
  const { fakeNames } = await import('./writer-surface-fakes')
  return fakeNames(await importOriginal<typeof import('@/platform/collab/names')>())
})
vi.mock('./VersionPreview.vue', async () =>
  (await import('./writer-surface-fakes')).fakeVersionPreview(),
)

const SERVER_FAILURE = 'The server had a problem opening this document. Try again in a moment.'
const GENERIC_FAILURE = "This document couldn't be opened."
const SIGNED_OUT = "You're signed out. Sign in to open this document."

function forbidden() {
  return new TransportError({ type: 'Permission', message: '', status: 403 })
}

function serverError() {
  return new TransportError({ type: 'Server', message: '', status: 500 })
}

function headerOf(root: Element) {
  return {
    saveState: root.querySelector('[data-save-state]')!.textContent || undefined,
    viewOnly: String(!!root.querySelector('[data-view-only]')),
  }
}

let rowReads = 0
function readsRow(fails: () => boolean, failure: () => TransportError = serverError) {
  query.mockImplementation(async (operation: unknown) => {
    if (operation !== api.writer.documents.get) {
      return {}
    }

    rowReads++
    if (fails()) {
      throw failure()
    }

    return { name: 'content-1', collab: 1, settings: {}, html: '', content: '' }
  })
}

afterEach(() => {
  resetSurface()
  query.mockReset()
  rowReads = 0
})

describe('Writer surface failing to open', () => {
  it('offers Try again with the rail back when the row read fails, then opens without a second room', async () => {
    liveRoom()
    let isFailing = true
    readsRow(() => isFailing)
    const root = await mountedSurface()

    await vi.waitFor(() => expect(root.textContent).toContain(SERVER_FAILURE))
    expect(railHidden.value).toBe(false)
    expect(rooms.opens).toBe(1)

    isFailing = false
    buttonLabelled(root, 'Try again')!.click()

    await vi.waitFor(() => expect(root.querySelector('[data-editor]')).not.toBeNull())
    expect(railHidden.value).toBe(true)
    expect(rowReads).toBe(2)
    expect(rooms.opens).toBe(1)
  })

  it('offers the document menu only once the document has opened', async () => {
    liveRoom()
    let isFailing = true
    readsRow(() => isFailing)
    const root = await mountedSurface()

    await vi.waitFor(() => expect(root.textContent).toContain(SERVER_FAILURE))
    expect(root.querySelector('[data-open-comments], [data-open-versions]')).toBeNull()
    expect(root.querySelector('[data-download]')).toBeNull()

    isFailing = false
    buttonLabelled(root, 'Try again')!.click()

    await vi.waitFor(() => expect(root.querySelector('[data-editor]')).not.toBeNull())
    expect(root.querySelector('[data-open-comments]')).not.toBeNull()
    expect(root.querySelector('[data-open-versions]')).not.toBeNull()
    expect(root.querySelector('[data-download]')).not.toBeNull()
  })

  it('goes back to the failed page when trying again fails too', async () => {
    liveRoom()
    readsRow(() => true)
    const root = await mountedSurface()
    await vi.waitFor(() => expect(buttonLabelled(root, 'Try again')).toBeDefined())

    buttonLabelled(root, 'Try again')!.click()
    await vi.waitFor(() => expect(rowReads).toBe(2))
    await nextTick()
    await vi.waitFor(() => expect(root.textContent).toContain(SERVER_FAILURE))
    expect(railHidden.value).toBe(false)
  })

  it('offers Try again with the rail back when the room fails to open, then opens the room', async () => {
    readsRow(() => false)
    rooms.openFailure = serverError()
    const root = await mountedSurface()

    await vi.waitFor(() => expect(root.textContent).toContain(SERVER_FAILURE))
    expect(railHidden.value).toBe(false)

    rooms.openFailure = null
    liveRoom()
    buttonLabelled(root, 'Try again')!.click()

    await vi.waitFor(() => expect(root.querySelector('[data-editor]')).not.toBeNull())
    expect(railHidden.value).toBe(true)
    expect(rowReads).toBe(1)
    expect(rooms.opens).toBe(2)
  })

  it('shows the failed page with no second room when the row read is refused', async () => {
    liveRoom()
    readsRow(() => true, forbidden)
    const root = await mountedSurface()

    await vi.waitFor(() => expect(root.textContent).toContain(GENERIC_FAILURE))
    expect(buttonLabelled(root, 'Try again')).toBeDefined()
    expect(railHidden.value).toBe(false)
    expect(rooms.opens).toBe(1)

    buttonLabelled(root, 'Try again')!.click()
    await vi.waitFor(() => expect(rowReads).toBe(2))
    expect(rooms.opens).toBe(1)
  })

  it("gives the room's reason when the row and the room both fail", async () => {
    readsRow(() => true, forbidden)
    rooms.openFailure = new CollabOpenError(401, 'signed_out')
    const root = await mountedSurface()

    await vi.waitFor(() => expect(root.textContent).toContain(SIGNED_OUT))
    expect(root.textContent).not.toContain(GENERIC_FAILURE)
  })

  it('claims nothing in the header on a failed page', async () => {
    liveRoom()
    let isFailing = true
    readsRow(() => isFailing)
    const root = await mountedSurface()
    await vi.waitFor(() => expect(buttonLabelled(root, 'Try again')).toBeDefined())
    expect(headerOf(root)).toEqual({ saveState: undefined, viewOnly: 'false' })

    isFailing = false
    buttonLabelled(root, 'Try again')!.click()
    await vi.waitFor(() => expect(root.querySelector('[data-editor]')).not.toBeNull())
    expect(headerOf(root)).toEqual({ saveState: 'clean', viewOnly: 'false' })
  })

  it('claims nothing in the header when the room fails to open', async () => {
    readsRow(() => false)
    rooms.openFailure = serverError()
    const root = await mountedSurface()

    await vi.waitFor(() => expect(buttonLabelled(root, 'Try again')).toBeDefined())
    expect(headerOf(root)).toEqual({ saveState: undefined, viewOnly: 'false' })
  })
})
