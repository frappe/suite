import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Document from '@tiptap/extension-document'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import { BulletList, ListItem } from '@tiptap/extension-list'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { EditorState } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { ySyncPlugin } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it } from 'vitest'
import * as yjs from 'yjs'

import { writerSchema } from '../schema'
import { anchorEnds, DOCUMENT_ANCHOR, encodeAnchor, readAnchor } from './anchors'
import { anchorSelection, placeThread } from './places'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy()
  }
})

function openEditor(doc = new yjs.Doc()) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      Document,
      Paragraph,
      Text,
      BulletList,
      ListItem,
      HorizontalRule,
      Collaboration.configure({ document: doc }),
    ],
  })
  editors.push(editor)
  return editor
}

// Writer's own schema, with the mention, tag and line break a quote has to read
function openWriterEditor(content: string) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...writerSchema(), Collaboration.configure({ document: new yjs.Doc() })],
  })
  editors.push(editor)
  editor.commands.setContent(content)
  return editor
}

function quoteOf(editor: Editor, from: number, to: number) {
  editor.commands.setTextSelection({ from, to })
  const read = readAnchor(anchorSelection(editor.state)!)
  if (read.kind !== 'text') {
    return read.kind
  }

  return read.quote
}

function paragraphText(doc: yjs.Doc, index = 0) {
  return (doc.getXmlFragment('default').get(index) as yjs.XmlElement).get(0) as yjs.XmlText
}

// A thread on characters [start, end) of a paragraph, made the way a tab makes one
function anchorOn(text: yjs.XmlText, start: number, end: number) {
  const from = yjs.createRelativePositionFromTypeIndex(text, start, 0)
  const to = yjs.createRelativePositionFromTypeIndex(text, end, -1)
  return encodeAnchor(from, to, text.toString().slice(start, end))
}

function shownText(editor: Editor, anchor: string) {
  const place = placeThread(editor.state, anchor)
  if (place.kind !== 'text') {
    return place.kind
  }

  return editor.state.doc.textBetween(place.from, place.to)
}

describe('where a thread shows', () => {
  it('follows its words while text is typed before them and at both edges', () => {
    const doc = new yjs.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p>')
    const anchor = anchorOn(paragraphText(doc), 6, 11)

    editor.commands.insertContentAt(1, 'well, ')
    editor.commands.insertContentAt(13, '[')
    editor.commands.insertContentAt(19, ']')

    expect([editor.getText(), shownText(editor, anchor)]).toEqual(['well, hello [world]', 'world'])
  })

  it('keeps what is left when its first or last character is deleted', () => {
    const doc = new yjs.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p>')
    const anchor = anchorOn(paragraphText(doc), 6, 11)

    editor.commands.deleteRange({ from: 7, to: 8 })
    editor.commands.deleteRange({ from: 10, to: 11 })

    expect(shownText(editor, anchor)).toBe('orl')
  })

  it('is deleted, with its quote, once all its words are gone or their paragraph is', () => {
    const doc = new yjs.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p><p>second line</p>')
    const onWorld = anchorOn(paragraphText(doc), 6, 11)
    const onSecond = anchorOn(paragraphText(doc, 1), 0, 6)

    editor.commands.deleteRange({ from: 7, to: 12 })
    editor.commands.deleteRange({ from: 8, to: 21 })

    expect(editor.getText()).toBe('hello ')
    expect(placeThread(editor.state, onWorld)).toEqual({ kind: 'deleted', quote: 'world' })
    expect(placeThread(editor.state, onSecond)).toEqual({ kind: 'deleted', quote: 'second' })
  })

  it("waits for another tab's text before showing a thread on it", () => {
    const local = new yjs.Doc()
    const editor = openEditor(local)
    editor.commands.setContent('<p>hello</p>')
    const remote = new yjs.Doc()
    yjs.applyUpdate(remote, yjs.encodeStateAsUpdate(local))
    const before = yjs.encodeStateVector(remote)
    paragraphText(remote).insert(5, ' there')
    const anchor = anchorOn(paragraphText(remote), 6, 11)

    const waiting = placeThread(editor.state, anchor)
    yjs.applyUpdate(local, yjs.encodeStateAsUpdate(remote, before))

    expect(waiting).toEqual({ kind: 'arriving', quote: 'there' })
    expect(shownText(editor, anchor)).toBe('there')
  })

  it('waits for the editor to draw its text when asked before the first render', () => {
    const doc = new yjs.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p>')
    const anchor = anchorOn(paragraphText(doc), 6, 11)

    const opening = EditorState.create({
      schema: editor.schema,
      plugins: [ySyncPlugin(doc.getXmlFragment('default'))],
    })

    const waiting = placeThread(opening, anchor)
    const view = new EditorView(document.createElement('div'), { state: opening })
    const drawn = placeThread(view.state, anchor)
    const shown = drawn.kind === 'text' && view.state.doc.textBetween(drawn.from, drawn.to)
    view.destroy()

    expect(waiting).toEqual({ kind: 'arriving', quote: 'world' })
    expect(shown).toBe('world')
  })

  it('shows a document thread on the document and an old comment id as not attached', () => {
    const editor = openEditor()

    expect(placeThread(editor.state, DOCUMENT_ANCHOR)).toEqual({ kind: 'document' })
    expect(placeThread(editor.state, '5f0c2e6a-old-comment')).toEqual({ kind: 'unplaced' })
  })

  it('shows a thread stored as deleted as deleted, with its quote', () => {
    const editor = openEditor()

    expect(placeThread(editor.state, '{"v":1,"q":""}')).toEqual({ kind: 'deleted', quote: '' })
  })
})

// Each pair of client ids, local then remote, so either one can win yjs's ordering
const ORDERINGS = [
  [1, 2],
  [2, 1],
  [100, 7],
  [7, 100],
]

// A thread on "quick brown" made in a tab, and another tab's doc holding the same text
function threadWithRemote([localClient, remoteClient]: number[]) {
  const local = new yjs.Doc()
  local.clientID = localClient
  const editor = openEditor(local)
  editor.commands.setContent('<p>The quick brown fox jumps</p>')
  editor.commands.setTextSelection({ from: 5, to: 16 })
  const anchor = anchorSelection(editor.state)!
  const remote = new yjs.Doc()
  remote.clientID = remoteClient
  yjs.applyUpdate(remote, yjs.encodeStateAsUpdate(local))
  return { local, editor, anchor, remote }
}

function editRemotely(local: yjs.Doc, remote: yjs.Doc, edit: (doc: yjs.Doc) => void) {
  const before = yjs.encodeStateVector(local)
  edit(remote)
  yjs.applyUpdate(local, yjs.encodeStateAsUpdate(remote, before))
}

function shownAfterRemoteEdit(ordering: number[], edit: (text: yjs.XmlText) => void) {
  const { local, editor, anchor, remote } = threadWithRemote(ordering)
  editRemotely(local, remote, (doc) => edit(paragraphText(doc)))
  const place = placeThread(editor.state, anchor)
  if (place.kind !== 'text') {
    return place
  }

  return editor.state.doc.textBetween(place.from, place.to)
}

describe('where a thread shows after another tab edits its text', () => {
  const removed = { kind: 'deleted', quote: 'quick brown' }

  it.each([
    {
      name: 'retypes its first character',
      edit: (text: yjs.XmlText) => {
        text.delete(4, 1)
        text.insert(4, 'Q')
      },
      shown: 'Quick brown',
    },
    {
      name: 'types inside it',
      edit: (text: yjs.XmlText) => text.insert(9, ' very'),
      shown: 'quick very brown',
    },
    {
      name: 'deletes it with its neighbours',
      edit: (text: yjs.XmlText) => text.delete(3, 13),
      shown: removed,
    },
    {
      name: 'deletes its last character',
      edit: (text: yjs.XmlText) => text.delete(14, 1),
      shown: 'quick brow',
    },
    { name: 'deletes all of it', edit: (text: yjs.XmlText) => text.delete(4, 11), shown: removed },
    {
      name: 'types right after it',
      edit: (text: yjs.XmlText) => text.insert(15, '!!'),
      shown: 'quick brown',
    },
    {
      name: 'types right before it',
      edit: (text: yjs.XmlText) => text.insert(4, '>>'),
      shown: 'quick brown',
    },
  ])('shows the same place in every client order when another tab $name', ({ edit, shown }) => {
    const places = ORDERINGS.map((ordering) => shownAfterRemoteEdit(ordering, edit))

    expect(places).toEqual(ORDERINGS.map(() => shown))
  })

  it('is deleted, with its quote, in a doc opened after its paragraph was deleted and collected', () => {
    const places = ORDERINGS.map((ordering) => {
      const { local, anchor, remote } = threadWithRemote(ordering)
      editRemotely(local, remote, (doc) => doc.getXmlFragment('default').delete(0, 1))
      const fresh = new yjs.Doc()
      yjs.applyUpdate(fresh, yjs.encodeStateAsUpdate(local))
      return placeThread(openEditor(fresh).state, anchor)
    })

    expect(places).toEqual(ORDERINGS.map(() => removed))
  })
})

const PARAGRAPHS = { content: '<p>aa bb</p><p>cc dd</p>', from: 4, to: 10 }
const LIST_ITEMS = {
  content: '<ul><li><p>aa bb</p></li><li><p>cc dd</p></li></ul>',
  from: 6,
  to: 14,
}
const RULED = { content: '<p>aa bb</p><hr><p>cc dd</p>', from: 4, to: 11 }

// A thread from "bb" to "cc", across two paragraphs, made in a tab
function threadAcrossParagraphs({ content, from, to }: typeof PARAGRAPHS) {
  const local = new yjs.Doc()
  const editor = openEditor(local)
  editor.commands.setContent(content)
  editor.commands.setTextSelection({ from, to })
  return { local, editor, anchor: anchorSelection(editor.state)! }
}

// Where it shows after `edit` in the editing tab, a tab it reaches, and a doc opened after it
function shownInEveryTab(edit: (editor: Editor) => void, paragraphs = PARAGRAPHS) {
  const { local, editor, anchor } = threadAcrossParagraphs(paragraphs)
  const remote = new yjs.Doc()
  yjs.applyUpdate(remote, yjs.encodeStateAsUpdate(local))
  const remoteEditor = openEditor(remote)
  edit(editor)
  yjs.applyUpdate(remote, yjs.encodeStateAsUpdate(local, yjs.encodeStateVector(remote)))
  const fresh = new yjs.Doc()
  yjs.applyUpdate(fresh, yjs.encodeStateAsUpdate(local))
  return [editor, remoteEditor, openEditor(fresh)].map((each) => shownText(each, anchor))
}

function deleteBetween(from: number, to: number) {
  return (editor: Editor) => {
    editor.commands.setTextSelection({ from, to })
    editor.commands.deleteSelection()
  }
}

function joinBackwardAt(position: number) {
  return (editor: Editor) => {
    editor.commands.setTextSelection(position)
    editor.commands.joinBackward()
  }
}

describe('where a thread across two paragraphs shows after the tab holding it edits', () => {
  it.each([
    { name: 'joins the paragraphs', edit: joinBackwardAt(8), shown: 'deleted' },
    {
      name: 'joins the list items they are in',
      paragraphs: LIST_ITEMS,
      edit: joinBackwardAt(12),
      shown: 'deleted',
    },
    { name: 'deletes across the paragraph break', edit: deleteBetween(5, 9), shown: 'deleted' },
    {
      name: 'deletes some of its words, leaving both paragraphs',
      edit: deleteBetween(4, 6),
      shown: 'cc',
    },
    {
      name: 'deletes all of its words, leaving both paragraphs',
      edit: (editor: Editor) => {
        deleteBetween(1, 6)(editor)
        deleteBetween(3, 5)(editor)
      },
      shown: 'deleted',
    },
    {
      name: 'deletes all of its words, leaving a rule between the paragraphs',
      paragraphs: RULED,
      edit: (editor: Editor) => {
        deleteBetween(1, 6)(editor)
        deleteBetween(4, 6)(editor)
      },
      shown: '',
    },
    { name: 'leaves it alone', edit: () => {}, shown: 'bbcc' },
  ])('shows the same in every tab when it $name', ({ edit, paragraphs, shown }) => {
    expect(shownInEveryTab(edit, paragraphs)).toEqual([shown, shown, shown])
  })
})

describe('an anchor on the selection', () => {
  it('holds its first and last characters, so text typed at either edge stays outside', () => {
    const doc = new yjs.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p><p>second line</p>')
    editor.commands.setTextSelection({ from: 7, to: 20 })
    const anchor = anchorSelection(editor.state)!

    editor.commands.insertContentAt(20, '!')
    editor.commands.insertContentAt(7, '[')

    expect([placeThread(editor.state, anchor), editor.getText({ blockSeparator: '|' })]).toEqual([
      { kind: 'text', from: 8, to: 21, quote: 'world second' },
      'hello [world|second! line',
    ])
  })

  it('names the characters at its ends for the saved check', () => {
    const doc = new yjs.Doc()
    const editor = openEditor(doc)
    editor.commands.setContent('<p>hello world</p>')
    editor.commands.setTextSelection({ from: 7, to: 12 })
    const text = paragraphText(doc)
    const [first, last] = [6, 10].map((index) => {
      const item = yjs.createRelativePositionFromTypeIndex(text, index, 0).item!
      return [item.client, item.clock]
    })

    const ends = anchorEnds(anchorSelection(editor.state)!).map((id) => [id.client, id.clock])

    expect(ends).toEqual([first, last])
  })

  it('is none for an empty selection, and a document anchor has no ends', () => {
    const editor = openEditor()
    editor.commands.setContent('<p>hello</p>')
    editor.commands.setTextSelection(3)

    expect([anchorSelection(editor.state), anchorEnds(DOCUMENT_ANCHOR)]).toEqual([null, []])
  })
})

const MENTION = '<span class="mention" data-type="mention" data-id="u1" data-label="Ann"></span>'

describe("an anchor's quote", () => {
  it('reads a mention as the editor writes it out', () => {
    const editor = openWriterEditor(`<p>hi ${MENTION} there</p>`)

    expect(quoteOf(editor, 1, 11)).toBe('hi @Ann there')
  })

  it('quotes a lone mention by its own text', () => {
    const editor = openWriterEditor(`<p>a${MENTION}b</p>`)

    expect(quoteOf(editor, 2, 3)).toBe('@Ann')
  })

  it('reads a tag and a line break as the editor writes them out', () => {
    const tag = '<span class="tag-item" data-tag-id="t1" data-tag-label="urgent"></span>'
    const editor = openWriterEditor(`<p>see ${tag}<br>now</p>`)

    expect(quoteOf(editor, 1, 10)).toBe('see #urgent\nnow')
  })
})
