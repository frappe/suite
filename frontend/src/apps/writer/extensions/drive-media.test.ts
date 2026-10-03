import { Editor, Node } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'

import type { MediaHandle, MediaStatus } from '@/apps/drive'

import { DriveMedia, mediaNodeId } from './drive-media'

// A leaf media node view, as frappe-ui's image node view is.
const Picture = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes: () => ({ src: { default: null } }),
  parseHTML: () => [{ tag: 'img[src]' }],
  renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes],
  addNodeView:
    () =>
    ({ node }) => {
      const dom = document.createElement('img')
      dom.setAttribute('src', node.attrs.src)
      return { dom, ignoreMutation: () => true }
    },
})

const STORED = '/api/method/suite.writer.api.embed.get?id=media-1'

function fakeMedia() {
  const src = ref<string | null>(null)
  const status = ref<MediaStatus>('loading')
  const opened: string[] = []
  const media = (id: string): MediaHandle => {
    opened.push(id)
    return { id, src, cacheKey: ref(`drive-media:${id}`), status, refresh: async () => {} }
  }
  return { media, src, status, opened }
}

const flush = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

let editor: Editor | null = null
afterEach(() => editor?.destroy())

describe('Writer media on a Drive session', () => {
  it('reads the media node id from both stored spellings', () => {
    expect(mediaNodeId(STORED)).toBe('media-1')
    expect(mediaNodeId('/api/method/writer.api.embed.get?id=abc_9&x=1')).toBe('abc_9')
    expect(mediaNodeId('https://example.com/cat.png', 'media-2')).toBe('media-2')
    expect(mediaNodeId('https://example.com/cat.png')).toBeNull()
    expect(mediaNodeId(null)).toBeNull()
  })

  it('shows the signed URL, follows a refresh, and keeps the stored URL in the document', async () => {
    const { media, src, opened } = fakeMedia()
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [Document, Paragraph, Text, Picture, DriveMedia.configure({ media })],
      content: `<p>Before</p><img src="${STORED}">`,
    })
    const shown = () => editor!.view.dom.querySelector('img')!.getAttribute('src')

    await flush()
    expect(opened).toEqual(['media-1'])
    expect(shown()).toBe(STORED) // nothing signed yet

    src.value = '/f/blob-1?signature=a'
    await flush()
    expect(shown()).toBe('/f/blob-1?signature=a')

    src.value = '/f/blob-1?signature=b'
    await flush()
    expect(shown()).toBe('/f/blob-1?signature=b')
    expect(editor.getHTML()).toContain(`src="${STORED}"`)
  })

  it('stops showing a picture once Drive refuses it', async () => {
    const { media, src, status } = fakeMedia()
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [Document, Paragraph, Text, Picture, DriveMedia.configure({ media })],
      content: `<img src="${STORED}">`,
    })
    const picture = () => editor!.view.dom.querySelector('img')!
    src.value = '/f/blob-1?signature=a'
    status.value = 'ready'
    await flush()
    expect(picture().getAttribute('src')).toBe('/f/blob-1?signature=a')

    status.value = 'refused'
    await flush()
    expect(picture().getAttribute('src')).toBe('')
    expect(picture().dataset.mediaState).toBe('refused')
    expect(editor.getHTML()).toContain(`src="${STORED}"`)
  })

  it('leaves media alone when no session provides handles', async () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [Document, Paragraph, Text, Picture, DriveMedia],
      content: `<img src="${STORED}">`,
    })
    await flush()
    expect(editor.view.dom.querySelector('img')!.getAttribute('src')).toBe(STORED)
  })
})
