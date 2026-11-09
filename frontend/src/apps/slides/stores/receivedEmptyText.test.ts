import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))
vi.mock('@/apps/slides/router', () => ({ router: { replace: () => Promise.resolve() } }))

const { activeElementIds, flushPendingBlur } = await import('./element')
const { slides, slideIndex } = await import('./slide')
const { slidesLength } = await import('./presentation')
const { setCommandHistory } = await import('./historyMeta')
const { setLiveSeat } = await import('./liveDeck')
const { useTextEditor } = await import('@/apps/slides/composables/useTextEditor')
const { liveTextExtensions } = await import('@/apps/slides/collab/liveText')

const { activeEditor, initTextEditor } = useTextEditor()

function typeInFragment(fragment: Y.XmlFragment, text: string) {
  const paragraph = new Y.XmlElement('paragraph')
  paragraph.insert(0, [new Y.XmlText(text)])
  fragment.insert(0, [paragraph])
}

const clearFragment = (fragment: Y.XmlFragment) => fragment.delete(0, fragment.length)

describe('leaving a text element whose text is empty, in a live room', () => {
  let fragment: Y.XmlFragment

  const elementsLeft = () => slides.value[0].elements.map(({ id }: { id: string }) => id)

  beforeEach(async () => {
    const doc = new Y.Doc()
    fragment = doc.getXmlFragment('text')
    const undoManager = new Y.UndoManager(fragment)
    const presence = {
      awareness: new Awareness(doc),
      peers: [],
      ownPid: 1,
      ownArrival: null,
      onChange: () => () => {},
    }
    setLiveSeat({
      push: () => {},
      flush: () => {},
      undo: () => {},
      redo: () => {},
      endStep: () => {},
      bindText: () => ({
        extensions: liveTextExtensions(fragment, presence, undoManager),
        seeded: false,
      }),
    })
    setCommandHistory({
      execute: (command: { execute: (state: unknown) => void }) => command.execute(slides.value),
      record: () => {},
    })
    slides.value = [
      {
        clientId: 'A',
        elements: [{ id: 't1', type: 'text', left: 1, top: 1, width: 9, height: 9 }],
      },
    ]
    slidesLength.value = 1
    slideIndex.value = 0
    activeElementIds.value = ['t1']
    await nextTick()
    await nextTick()
    if (!activeEditor.value) initTextEditor('t1', '', true)
  })

  afterEach(() => {
    activeElementIds.value = []
    activeEditor.value?.destroy()
    activeEditor.value = null
    setLiveSeat(null)
  })

  it("keeps the element when a co-editor cleared this tab's typing", () => {
    activeEditor.value.commands.insertContent('mine')
    clearFragment(fragment)
    expect(activeEditor.value.getText()).toBe('')

    flushPendingBlur()

    expect(elementsLeft()).toEqual(['t1'])
  })

  it('deletes the element when this tab cleared what a co-editor typed', () => {
    typeInFragment(fragment, 'theirs')
    activeEditor.value.commands.clearContent(true)
    expect(activeEditor.value.getText()).toBe('')

    flushPendingBlur()

    expect(elementsLeft()).toEqual([])
  })
})
