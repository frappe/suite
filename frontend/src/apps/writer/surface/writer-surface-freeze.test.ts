import { toast } from 'frappe-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { Doc, encodeStateAsUpdate, XmlElement, XmlText } from 'yjs'

import { realEditors, stored } from './writer-surface-fakes'
import {
  buttonLabelled,
  liveRoom,
  oneVersion,
  openedSurface,
  previewAndReturn,
  resetSurface,
  settled,
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

afterEach(resetSurface)

const FROZEN = "Part of this document can't be shown here, so editing is paused to keep it safe."

// A live room whose body holds text this editor can't show, so the editor freezes on open
function frozenRoom() {
  const room = liveRoom()
  room.doc.getXmlFragment('default').insert(0, [unknownBlock()])
  return room
}

// A block of a kind Writer doesn't have, holding text
function unknownBlock() {
  const block = new XmlElement('mystery')
  block.insert(0, [new XmlText('Kept')])
  return block
}

// A paragraph holding `text`
function paragraph(text: string) {
  const block = new XmlElement('paragraph')
  block.insert(0, [new XmlText(text)])
  return block
}

// The old editor's body as the row stores it: collab 1, Yjs bytes in base64
function storeOldBody(text: string) {
  const old = new Doc()
  old.getXmlFragment('default').insert(0, [paragraph(text)])
  stored.collab = 1
  stored.content = btoa(String.fromCharCode(...encodeStateAsUpdate(old)))
  stored.html = '<p>stale</p>'
}

function editorText(root: Element) {
  return [...root.querySelectorAll('[data-editor] .ProseMirror')].map((body) => body.textContent)
}

// What the document menu offers: Save version, and Import DOCX, which writes the body
function menuOffers(root: Element) {
  function isShown(selector: string) {
    return !root.querySelector<HTMLElement>(selector)!.hidden
  }

  return { saveVersion: isShown('[data-save-version]'), importDocx: isShown('[data-import-docx]') }
}

function isEditorEditable(root: Element) {
  return root.querySelector('[data-editor] .ProseMirror')!.getAttribute('contenteditable')
}

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

describe('Writer surface', () => {
  it("shows the freeze strip with Reload when the document holds text the editor can't show", async () => {
    frozenRoom()
    const root = await openedSurface()

    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))
    const [page, reload] = [location, vi.fn()]
    vi.stubGlobal('location', { ...page, reload })
    buttonLabelled(root, 'Reload')!.click()
    vi.stubGlobal('location', page)

    expect(reload).toHaveBeenCalledOnce()
  })

  it('shows the stop strip, naming the freeze, when saving also stopped', async () => {
    const room = frozenRoom()
    room.status = { ...room.status, saveState: 'failed', unsentCount: 1 }
    const root = await openedSurface()

    await vi.waitFor(() =>
      expect(stripTexts(root)).toEqual([
        "Saving stopped in this tab. Part of this document can't be shown here, so editing stays paused. Reload to try saving again.",
      ]),
    )
    expect(buttonLabelled(root, 'Reload')).toBeDefined()
  })

  it("freezes the real collab editor over text it can't show", async () => {
    realEditors.isOn = true
    const room = frozenRoom()
    const presence = { awareness: new Awareness(room.doc), peers: [], onChange: () => () => {} }
    Object.assign(room, { presence })
    room.status = { ...room.status, restoreRev: 0 }
    const root = await openedSurface()

    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))
  })

  it('shows the freeze strip over the polling notice', async () => {
    const room = frozenRoom()
    room.status = { ...room.status, liveState: 'polling' }
    const root = await openedSurface()

    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))
  })

  it('shows only the version bar while a version is previewed over a freeze', async () => {
    frozenRoom()
    const root = await openedSurface(oneVersion)
    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))

    let during: string[] = []
    await previewAndReturn(root, () => {
      during = stripTexts(root)
    })

    expect([during, stripTexts(root)]).toEqual([['Viewing Before review'], [FROZEN]])
  })

  it('neither reports a frozen tab nor stops its room', async () => {
    const room = Object.assign(frozenRoom(), {
      stopForGood: vi.fn(async () => {}),
      suspect: { mark: vi.fn(), isJudging: false },
    })
    const root = await openedSurface()
    await vi.waitFor(() => expect(stripTexts(root)).toEqual([FROZEN]))
    await settled()

    expect([room.stopForGood.mock.calls, room.suspect.mark.mock.calls]).toEqual([[], []])
  })

  it('tells the person a paste is too large to add in one go', async () => {
    realEditors.isOn = true
    const room = liveRoom()
    const presence = { awareness: new Awareness(room.doc), peers: [], onChange: () => () => {} }
    const limits = {
      fragment: 1000,
      edit_max: 100,
      state_max: 10_000,
      state_bytes: 0,
      tail_bound: 0,
    }
    Object.assign(room, { presence })
    room.status = { ...room.status, restoreRev: 0, limits, isAtLimit: false }
    const error = vi.spyOn(toast, 'error')
    const root = await openedSurface()

    const element = root.querySelector<EditorElement>('[data-editor] .ProseMirror')!
    const clipboard = new Map([['text/plain', 'x'.repeat(200)]])
    const clipboardData = { getData: (type: string) => clipboard.get(type) ?? '' }
    const paste = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData,
    })
    element.dispatchEvent(paste)

    expect(error).toHaveBeenCalledWith(
      'This is too large to add in one go. Add it in smaller parts.',
    )
  })

  it('shows the stored body read-only when the open gives no live room', async () => {
    storeOldBody('Old text')
    const root = await openedSurface()

    await vi.waitFor(() => expect(editorText(root)).toEqual(['Old text']))
    expect(isEditorEditable(root)).toBe('false')
  })

  it('shows only the live room, not the stored body, when the open gives one', async () => {
    storeOldBody('Old text')
    const room = liveRoom()
    room.doc.getXmlFragment('default').insert(0, [paragraph('Live text')])
    const root = await openedSurface()

    await vi.waitFor(() => expect(editorText(root)).toEqual(['Live text']))
  })

  it('offers no Save version or import when the open gives no live room', async () => {
    storeOldBody('Old text')
    const root = await openedSurface()
    await vi.waitFor(() => expect(editorText(root)).toEqual(['Old text']))

    expect(menuOffers(root)).toEqual({ saveVersion: false, importDocx: false })
  })
})

describe('Writer surface against the minimum Writer build', () => {
  afterEach(() => serverMinBuilds({}))

  it('edits a live document while the tab meets the minimum Writer build', async () => {
    await serverMinBuilds({ writer: '100' })
    liveRoom()
    const root = await openedSurface()

    expect([isEditorEditable(root), menuOffers(root)]).toEqual([
      'true',
      { saveVersion: true, importDocx: true },
    ])
  })

  it('opens a live document read-only in a tab older than the minimum Writer build', async () => {
    await serverMinBuilds({ writer: '150' })
    liveRoom()
    const root = await openedSurface()

    expect([isEditorEditable(root), menuOffers(root).importDocx]).toEqual(['false', false])
  })
})
