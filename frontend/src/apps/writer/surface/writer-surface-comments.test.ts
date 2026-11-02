import type { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { Awareness } from 'y-protocols/awareness'
import { createRelativePositionFromTypeIndex, XmlElement, XmlText, type Doc } from 'yjs'

import type { DocumentThread } from '@/apps/drive'
import { encodeAnchor } from '@/apps/writer/collab/anchors'

import { realEditors } from './writer-surface-fakes'
import {
  liveRoom,
  openedSurface,
  resetSurface,
  settled,
  type Comments,
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

describe('commenting from the editor', () => {
  // Drafts are kept in the tab and on the device between opens
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  // The real collab editor over "hello world", with Drive holding `threads`
  async function openedOnText(threads: (doc: Doc) => DocumentThread[] = () => []) {
    realEditors.isOn = true
    const room = liveRoom()
    const paragraph = new XmlElement('paragraph')
    paragraph.insert(0, [new XmlText('hello world')])
    room.doc.getXmlFragment('default').insert(0, [paragraph])
    const presence = { awareness: new Awareness(room.doc), peers: [], onChange: () => () => {} }
    Object.assign(room, { presence })
    room.status = { ...room.status, restoreRev: 0 }
    const comments = { list: async () => ({ threads: threads(room.doc) }) } as unknown as Comments
    const root = await openedSurface(undefined, '/d/node-1', comments)
    const element = root.querySelector<EditorElement>('[data-editor] .ProseMirror')!
    return { root, editor: element.editor }
  }

  function pressCommentKeys(editor: TiptapEditor) {
    const keys = { key: 'm', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', keys))
  }

  function draftCount(root: Element) {
    return root.querySelectorAll('textarea[aria-label="Add a comment on the text"]').length
  }

  it('starts exactly one comment on the selected text on Ctrl+Alt+M', async () => {
    const { root, editor } = await openedOnText()

    editor.commands.setTextSelection({ from: 1, to: 6 })
    pressCommentKeys(editor)
    await settled()

    expect([draftCount(root), root.querySelector('aside')?.getAttribute('aria-label')]).toEqual([
      1,
      'Comments',
    ])
  })

  it('opens the whole-document box, ready to type in, on Ctrl+Alt+M with nothing selected', async () => {
    const { root, editor } = await openedOnText()

    editor.commands.setTextSelection(3)
    pressCommentKeys(editor)
    await settled()

    const box = root.querySelector('aside textarea[aria-label="Add a comment"]')
    expect([box !== null, document.activeElement === box, draftCount(root)]).toEqual([
      true,
      true,
      0,
    ])
  })

  it('lights the text of a pointed-at row, then shows it darker and in view once opened', async () => {
    const { root, editor } = await openedOnText((doc) => [threadOnWorld(doc)])
    root.querySelector<HTMLElement>('[data-open-comments]')!.click()
    await vi.waitFor(() => expect(root.querySelector('aside li')).not.toBeNull())
    const row = root.querySelector('aside li')!
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    function textClass() {
      return editor.view.dom.querySelector('[data-thread]')?.className
    }

    row.dispatchEvent(new MouseEvent('mouseenter'))
    await nextTick()
    const pointed = textClass()
    row.querySelector('button')!.click()
    await nextTick()
    const textScrolls = scrolled.mock.contexts.filter(
      (element) => element instanceof HTMLSpanElement,
    )

    expect([pointed, textClass(), textScrolls.length]).toEqual(['is-lit', 'is-open', 1])
  })

  it('opens the comments panel on the thread whose highlighted text is clicked', async () => {
    const { root, editor } = await openedOnText((doc) => [threadOnWorld(doc)])
    await vi.waitFor(() => expect(editor.view.dom.querySelector('[data-thread]')).not.toBeNull())

    const world = editor.view.dom.querySelector('[data-thread]')!
    editor.view.someProp('handleClick', (click) =>
      click(editor.view, 8, { target: world } as never),
    )
    await settled()

    const expanded = root.querySelector('aside li > button[aria-expanded="true"]')
    expect(expanded?.closest('li')?.textContent).toContain('About the world')
  })
})

// A thread on "world" in a document reading "hello world"
function threadOnWorld(doc: Doc) {
  const text = (doc.getXmlFragment('default').get(0) as XmlElement).get(0) as XmlText
  const from = createRelativePositionFromTypeIndex(text, 6, 0)
  const to = createRelativePositionFromTypeIndex(text, 11, -1)
  const comment = {
    name: 'c1',
    author: 'ann@example.com',
    author_name: null,
    person: { full_name: 'Ann' },
    content: 'About the world',
    creation: new Date().toISOString(),
  }
  const anchor = encodeAnchor(from, to, 'world')
  return {
    name: 'world',
    anchor,
    resolved: false,
    comments: [comment],
  } as unknown as DocumentThread
}
