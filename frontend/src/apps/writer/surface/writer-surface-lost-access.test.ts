import { toast } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import {
  buttonLabelled,
  discardCopies,
  liveRoom,
  openedSurface,
  resetSurface,
  stoppedRoom,
  stripTexts,
  type EditorElement,
} from './writer-surface-fixtures'

vi.hoisted(() => {
  vi.stubGlobal('__SUITE_BUILD__', '100')
  vi.stubEnv('DEV', false)
})

vi.mock('frappe-ui', async () => (await import('./writer-surface-fakes')).fakeFrappeUi())
vi.mock('@/apps/drive', async () => (await import('./writer-surface-fakes')).fakeDrive())
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

const { keepPageCopy, listCopies } = await import('@/apps/writer/recovery/copies')

afterEach(resetSurface)

// Types a line the room has yet to send, shuts the write gate, and takes the file the toast's Download my changes saves
async function downloadedChanges(afterClose: (root: Element) => unknown = () => {}, role = 30) {
  const room = liveRoom()
  room.status = { ...room.status, saveState: 'unsaved', unsentCount: 1 }
  const access = ref({ role: 50 })
  const root = await openedSurface(undefined, '/d/node-1', undefined, access)
  root
    .querySelector<EditorElement>('[data-editor] .ProseMirror')!
    .editor.commands.insertContent('Unsent line')
  const files: Blob[] = []
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      files.push(blob)
      return 'blob:changes'
    },
    revokeObjectURL: () => {},
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const warning = vi.spyOn(toast, 'warning')

  access.value = { role }
  await vi.waitFor(() => expect(warning).toHaveBeenCalled())
  await afterClose(root)
  const [, shown] = warning.mock.lastCall!
  ;(shown?.action as { onClick: () => void }).onClick()
  await vi.waitFor(() => expect(files).toHaveLength(1))
  return files[0] as File
}

describe('Writer surface', () => {
  it('asks to keep the tab open, with no Reload, and warns on leaving, when typing after a lost right is kept nowhere', async () => {
    const room = stoppedRoom()
    room.status = {
      ...room.status,
      blockReason: 'lost_read',
      stopReason: 'lost_access',
      hasCopyFailed: true,
    }
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    const root = await openedSurface()
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)

    expect(stripTexts(root)).toEqual([
      "You can no longer open this document. Unsent changes couldn't be kept on this device, so keep this tab open.",
    ])
    expect([buttonLabelled(root, 'Reload'), leaving.defaultPrevented]).toEqual([undefined, true])
  })

  it('keeps a page copy of typing after a lost right that the device could not keep', async () => {
    const listeners: (() => void)[] = []
    const room = liveRoom()
    room.status = { ...room.status, blockReason: 'lost_read', stopReason: 'lost_access' }
    Object.assign(room, {
      onChange(listener: () => void) {
        listeners.push(listener)
        return () => {}
      },
    })
    const root = await openedSurface()
    room.status = { ...room.status, saveState: 'failed', unsentCount: 1, hasCopyFailed: true }
    for (const listener of listeners) {
      listener()
    }

    await nextTick()

    expect(stripTexts(root)).toEqual([
      'You can no longer open this document. Unsent changes were kept as a recovery copy.',
    ])
    expect(await listCopies('node-1')).toHaveLength(1)
    await discardCopies()
  })

  it('downloads the line typed but not yet sent from the lost-access toast, before the device keeps a copy', async () => {
    const file = await downloadedChanges()

    expect(file.name).toBe('Quarterly plan (recovered).html')
    expect(await file.text()).toContain('<p>Unsent line</p>')
  })

  it('downloads the line typed but not yet sent from the lost-access toast, not an older copy on the device', async () => {
    keepPageCopy('node-1', 'Quarterly plan', '<p>Older copy</p>', new Date('2026-01-01'))
    const file = await downloadedChanges()

    expect(await file.text()).toContain('<p>Unsent line</p>')
    await discardCopies()
  })

  it('downloads the work held when editing access was lost, not what the editor shows after a rebuild', async () => {
    const file = await downloadedChanges((root) =>
      root
        .querySelector<EditorElement>('[data-editor] .ProseMirror')!
        .editor.commands.setContent('<p>Server text</p>'),
    )

    expect(await file.text()).toContain('<p>Unsent line</p>')
    expect(await file.text()).not.toContain('Server text')
  })

  it('downloads the work held when the document became unreadable, not an older copy on the device', async () => {
    keepPageCopy('node-1', 'Quarterly plan', '<p>Older copy</p>', new Date('2026-01-01'))
    const file = await downloadedChanges(
      (root) => vi.waitFor(() => expect(root.querySelector('[data-editor]')).toBeNull()),
      0,
    )

    expect(await file.text()).toContain('<p>Unsent line</p>')
    await discardCopies()
  })

  it('tells the room that editing access was lost when the role drops below edit', async () => {
    const room = liveRoom()
    const access = ref({ role: 50 })
    await openedSurface(undefined, '/d/node-1', undefined, access)

    access.value = { role: 30 }

    expect(room.loseAccess).toHaveBeenCalledWith('lost_edit')
  })

  it('tells the room that reading access was lost when the document is refused, before its role drops', async () => {
    const room = liveRoom()
    const state = ref('Active')
    await openedSurface(undefined, '/d/node-1', undefined, undefined, state)

    state.value = 'Refused'

    expect(room.loseAccess).toHaveBeenCalledWith('lost_read')
  })

  it("shows the read-only notice, with no download, when the only unsent work is another tab's", async () => {
    const room = liveRoom()
    room.status = { ...room.status, saveState: 'unsaved', othersUnsentCount: 3 }
    const access = ref({ role: 50 })
    await openedSurface(undefined, '/d/node-1', undefined, access)
    const warning = vi.spyOn(toast, 'warning')

    access.value = { role: 30 }

    await vi.waitFor(() => expect(warning).toHaveBeenCalled())
    expect(warning.mock.calls).toEqual([
      ['Editing access changed. This document is now read-only.'],
    ])
  })

  it('still shows the read-only notice when the room fails to settle the lost access', async () => {
    const room = liveRoom()
    room.loseAccess.mockRejectedValue(new Error('Copy not kept'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const access = ref({ role: 50 })
    await openedSurface(undefined, '/d/node-1', undefined, access)
    const warning = vi.spyOn(toast, 'warning')

    access.value = { role: 30 }

    await vi.waitFor(() => expect(warning).toHaveBeenCalled())
    expect(warning.mock.calls).toEqual([
      ['Editing access changed. This document is now read-only.'],
    ])
  })

  it('gives the room editing back and shows no notice when access returns before the room settles', async () => {
    const room = liveRoom()
    const losing = Promise.withResolvers<void>()
    room.loseAccess.mockReturnValue(losing.promise)
    const access = ref({ role: 50 })
    await openedSurface(undefined, '/d/node-1', undefined, access)
    const warning = vi.spyOn(toast, 'warning')

    access.value = { role: 30 }
    access.value = { role: 50 }
    losing.resolve()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(room.regainAccess).toHaveBeenCalledTimes(1)
    expect(warning).not.toHaveBeenCalled()
  })
})
