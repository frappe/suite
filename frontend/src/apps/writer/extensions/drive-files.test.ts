import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { writerEditorExtensions } from '../editor-extensions'
import type { DriveFile, PickDriveFile } from './drive-files'

vi.mock('@/apps/writer/utils', () => ({ insertTemplate: () => {} }))
vi.mock('@/apps/writer/resources', () => ({ getTemplates: {} }))

const file = (name: string, title: string, mime: string | null, kind = 'file'): DriveFile => ({
  name,
  title,
  kind,
  mime,
})

// jsdom has no layout; inserting media scrolls it into view
Element.prototype.scrollIntoView = vi.fn()

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function writerEditor(content: string, pickDriveFile?: PickDriveFile) {
  editor = new Editor({
    element: document.createElement('div'),
    content,
    extensions: writerEditorExtensions({
      isCollaborative: false,
      onCommentActivated: () => {},
      onAnchors: () => {},
      scrollParent: () => window,
      media: null,
      pickDriveFile,
    }),
  })
  return editor
}

/** Picks `picked` from Drive at the end of the first paragraph, and returns the saved HTML. */
async function insertPicked(picked: DriveFile | undefined, content = '<p>See:</p>') {
  const writer = writerEditor(content, async () => picked)
  writer.commands.setTextSelection(writer.state.doc.firstChild!.nodeSize - 1)
  expect(writer.commands.insertFromDrive()).toBe(true)
  await vi.waitFor(() => expect(writer.getHTML()).not.toBe(content))
  return writer.getHTML()
}

describe('inserting a Drive file', () => {
  it('shows a picture through Drive, so each reader loads it with their own access', async () => {
    const html = await insertPicked(file('pic1', 'Floor plan.png', 'image/png'))

    expect(html).toContain('<img src="/api/suite/drive/nodes/pic1/content" alt="Floor plan.png"')
  })

  it('plays a video through Drive', async () => {
    const html = await insertPicked(file('vid1', 'Demo.mp4', 'video/mp4'))

    expect(html).toMatch(/<video src="\/api\/suite\/drive\/nodes\/vid1\/content" title="Demo.mp4"/)
  })

  it('links any other file by its title', async () => {
    const html = await insertPicked(file('pdf1', 'Q3 report.pdf', 'application/pdf'))

    expect(html).toMatch(
      /<p>See:<a [^>]*href="\/d\/pdf1\/q3-report-pdf"[^>]*>Q3 report.pdf<\/a><\/p>/,
    )
  })

  it('links a document, whatever its stored type', async () => {
    const html = await insertPicked(file('doc1', 'Roadmap', null, 'document'))

    expect(html).toContain('href="/d/doc1/roadmap"')
  })

  it('turns selected text into the link instead of adding the title', async () => {
    const writer = writerEditor('<p>the report</p>', async () =>
      file('pdf1', 'Q3 report.pdf', 'application/pdf'),
    )
    writer.commands.setTextSelection({ from: 5, to: 11 })
    writer.commands.insertFromDrive()

    await vi.waitFor(() => expect(writer.getHTML()).toContain('</a>'))
    expect(writer.getHTML()).toMatch(
      /<p>the <a [^>]*href="\/d\/pdf1\/q3-report-pdf"[^>]*>report<\/a><\/p>/,
    )
  })

  it('changes nothing when the picker is cancelled', async () => {
    const pick = vi.fn(async () => undefined)
    const writer = writerEditor('<p>See:</p>', pick)
    writer.commands.insertFromDrive()

    await vi.waitFor(() => expect(pick).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(writer.getHTML()).toBe('<p>See:</p>')
  })

  it('is off where no Drive picker is available', () => {
    expect(writerEditor('<p></p>').can().insertFromDrive()).toBe(false)
  })
})

describe('a Drive file the reader cannot load', () => {
  it('shows a placeholder of the same size in place of the picture', async () => {
    const writer = writerEditor(
      '<p><img src="/api/suite/drive/nodes/pic1/content" width="400" height="260"></p>',
    )
    const picture = writer.view.dom.querySelector('img')!
    picture.dispatchEvent(new Event('error'))

    expect(picture.dataset.mediaState).toBe('unavailable')
    expect(picture.getAttribute('src')).toMatch(/^data:image\/svg\+xml,/)
    expect(decodeURIComponent(picture.src)).toContain('This Drive file is not available to you')
    expect([picture.getAttribute('width'), picture.getAttribute('height')]).toEqual(['400', '260'])
  })

  it('leaves a failed picture that is not a Drive file alone', () => {
    const writer = writerEditor('<p><img src="https://example.com/a.png"></p>')
    const picture = writer.view.dom.querySelector('img')!
    picture.dispatchEvent(new Event('error'))

    expect(picture.getAttribute('src')).toBe('https://example.com/a.png')
  })
})
