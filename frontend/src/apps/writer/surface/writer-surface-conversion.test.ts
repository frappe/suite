import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { Doc, encodeStateAsUpdate, XmlElement, XmlText } from 'yjs'

import type { DocumentThread } from '@/apps/drive'

import { downloaded, realtime, stored } from './writer-surface-fakes'
import {
  liveRoom,
  openedSurface,
  resetSurface,
  stripTexts,
  type Comments,
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

afterEach(() => {
  vi.useRealTimers()
  resetSurface()
})

const UPGRADING =
  'This document is being upgraded for editing together. It is read-only until then.'
const UNREADABLE = " Its saved body couldn't be read, so this is its last saved copy."

function paragraph(text: string) {
  const block = new XmlElement('paragraph')
  block.insert(0, [new XmlText(text)])
  return block
}

// An old collaborative document's body as its row stores it, waiting on `conversion`
function oldDocument(text: string, conversion: NonNullable<typeof stored.conversion>) {
  const old = new Doc()
  old.getXmlFragment('default').insert(0, [paragraph(text)])
  stored.collab = 1
  stored.content = btoa(String.fromCharCode(...encodeStateAsUpdate(old)))
  stored.html = '<p>stale</p>'
  stored.conversion = conversion
}

function editorText(root: Element) {
  return [...root.querySelectorAll('[data-editor] .ProseMirror')].map((body) => body.textContent)
}

function isEditorEditable(root: Element) {
  return root.querySelector('[data-editor] .ProseMirror')!.getAttribute('contenteditable')
}

function canSaveVersion(root: Element) {
  return !root.querySelector<HTMLButtonElement>('[data-save-version]')!.hidden
}

const REFUSED = "This document couldn't be upgraded, so it stays read-only."

// The rooms the server names for telling a waiting document's tabs its outcome
function told(keys: string[]) {
  return { epoch: 1, keys, epoch_seconds: 150, server_time: 150 }
}

function joined() {
  return [...realtime.socket.joined]
}

// Lets each poll a fake interval ran finish its reload
async function pollsSettled() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('Writer surface', () => {
  it('shows a document awaiting conversion read-only, says it is being upgraded, and offers no Save version', async () => {
    oldDocument('Old text', { state: 'pending' })
    const root = await openedSurface()

    await vi.waitFor(() => expect(editorText(root)).toEqual(['Old text']))
    expect(stripTexts(root)).toEqual([UPGRADING])
    expect(canSaveVersion(root)).toBe(false)
    expect(isEditorEditable(root)).toBe('false')
  })

  it('says a refused document stays read-only, without a reason when none is given', async () => {
    oldDocument('Old text', { state: 'refused' })
    const root = await openedSurface()

    await vi.waitFor(() =>
      expect(stripTexts(root)).toEqual([
        "This document couldn't be upgraded, so it stays read-only.",
      ]),
    )
  })

  it('names the reason a document was refused when the server gives one', async () => {
    oldDocument('Old text', { state: 'refused', reason: 'unknown_node: mystery' })
    const root = await openedSurface()

    await vi.waitFor(() =>
      expect(stripTexts(root)).toEqual([
        "This document couldn't be upgraded, so it stays read-only. Reason: unknown_node: mystery.",
      ]),
    )
  })

  it('downloads a refused document as its text, not its out-of-date HTML', async () => {
    oldDocument('Old text', { state: 'refused' })
    const root = await openedSurface()
    await vi.waitFor(() => expect(editorText(root)).toEqual(['Old text']))

    root.querySelector<HTMLElement>('[data-download]')!.click()

    expect(downloaded.html).toBe('<p>Old text</p>')
  })

  it('downloads the last saved copy when the stored body does not decode', async () => {
    oldDocument('Old text', { state: 'refused' })
    stored.content = btoa('ÿÿÿ')
    const root = await openedSurface()
    await vi.waitFor(() => expect(editorText(root)).toEqual(['stale']))

    root.querySelector<HTMLElement>('[data-download]')!.click()

    expect(downloaded.html).toBe('<p>stale</p>')
  })

  it('says the last saved copy is shown when the stored body does not decode', async () => {
    oldDocument('Old text', { state: 'pending' })
    stored.content = btoa('ÿÿÿ')
    const root = await openedSurface()

    await vi.waitFor(() => expect(stripTexts(root)).toEqual([`${UPGRADING}${UNREADABLE}`]))
  })

  it('opens the live room, with Save version, once a poll finds the document converted', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    oldDocument('Old text', { state: 'pending' })
    const root = await openedSurface()
    await vi.waitFor(() => expect(stripTexts(root)).toEqual([UPGRADING]))

    stored.conversion = null
    const room = liveRoom()
    room.doc.getXmlFragment('default').insert(0, [paragraph('Live text')])
    vi.advanceTimersByTime(15_000)

    await vi.waitFor(() => expect(editorText(root)).toEqual(['Live text']))
    expect([stripTexts(root), canSaveVersion(root)]).toEqual([[], true])
  })

  it('stays read-only after a poll while the document still awaits conversion', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    oldDocument('Old text', { state: 'pending' })
    const root = await openedSurface()
    await vi.waitFor(() => expect(stripTexts(root)).toEqual([UPGRADING]))

    liveRoom()
    vi.advanceTimersByTime(15_000)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect([editorText(root), stripTexts(root)]).toEqual([['Old text'], [UPGRADING]])
  })

  it('never reloads a document that opens refused', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    oldDocument('Old text', { state: 'refused' })
    const root = await openedSurface()
    await vi.waitFor(() => expect(stripTexts(root)).toEqual([REFUSED]))

    vi.advanceTimersByTime(45_000)
    await pollsSettled()

    expect(stored.reloads).toBe(0)
  })

  it('stops reloading once a poll finds the document refused', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    oldDocument('Old text', { state: 'pending' })
    const root = await openedSurface()
    await vi.waitFor(() => expect(stripTexts(root)).toEqual([UPGRADING]))

    stored.conversion = { state: 'refused' }
    vi.advanceTimersByTime(15_000)
    await vi.waitFor(() => expect(stripTexts(root)).toEqual([REFUSED]))
    vi.advanceTimersByTime(30_000)
    await pollsSettled()

    expect(stored.reloads).toBe(1)
  })

  it('opens the live room as soon as its rooms say the document converted, without a poll', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    oldDocument('Old text', { state: 'pending', rooms: told(['sc:a', 'sc:b']) })
    const root = await openedSurface()
    await vi.waitFor(() => expect(joined()).toEqual(['sc:a', 'sc:b']))

    stored.conversion = null
    const room = liveRoom()
    room.doc.getXmlFragment('default').insert(0, [paragraph('Live text')])
    realtime.socket.hear('suite_collab_converted', { state: 'converted' })

    await vi.waitFor(() => expect(editorText(root)).toEqual(['Live text']))
    expect([stripTexts(root), canSaveVersion(root), joined()]).toEqual([[], true, []])
  })

  it('says a document stays read-only as soon as its rooms say it was refused', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    oldDocument('Old text', { state: 'pending', rooms: told(['sc:a', 'sc:b']) })
    const root = await openedSurface()
    await vi.waitFor(() => expect(joined()).toEqual(['sc:a', 'sc:b']))

    stored.conversion = { state: 'refused' }
    realtime.socket.hear('suite_collab_converted', { state: 'refused' })

    await vi.waitFor(() => expect(stripTexts(root)).toEqual([REFUSED]))
    vi.advanceTimersByTime(30_000)
    await pollsSettled()
    expect([stored.reloads, joined()]).toEqual([1, []])
  })

  it('moves to the rooms each poll names while the document waits', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    oldDocument('Old text', { state: 'pending', rooms: told(['sc:a', 'sc:b']) })
    await openedSurface()
    await vi.waitFor(() => expect(joined()).toEqual(['sc:a', 'sc:b']))

    stored.conversion = { state: 'pending', rooms: told(['sc:b', 'sc:c']) }
    vi.advanceTimersByTime(15_000)

    await vi.waitFor(() => expect(joined()).toEqual(['sc:b', 'sc:c']))
  })

  it('names why a document waits when the server gives a reason', async () => {
    oldDocument('Old text', { state: 'pending', reason: 'node' })
    const root = await openedSurface()

    await vi.waitFor(() =>
      expect(stripTexts(root)).toEqual([
        `${UPGRADING} Reason: the server has no Node 22.13 or newer.`,
      ]),
    )
  })

  it("lets an editor change someone else's comment while the document awaits conversion", async () => {
    oldDocument('Old text', { state: 'pending' })
    const thread = {
      name: 'about',
      anchor: 'document',
      resolved: false,
      comments: [
        {
          name: 'c1',
          author: 'ann@example.com',
          author_name: null,
          person: { full_name: 'Ann' },
          content: 'About the plan',
          creation: new Date().toISOString(),
        },
      ],
    } as unknown as DocumentThread
    const comments = { list: async () => ({ threads: [thread] }) } as unknown as Comments
    const root = await openedSurface(undefined, '/d/node-1', comments)

    root.querySelector<HTMLElement>('[data-open-comments]')!.click()
    await vi.waitFor(() => expect(root.querySelector('aside li')).not.toBeNull())
    root.querySelector<HTMLElement>('aside li button')!.click()
    await nextTick()

    const actions = [...root.querySelectorAll('aside [data-menu] button')]
    expect(actions.map((action) => action.textContent)).toEqual(['Edit', 'Delete'])
  })
})
