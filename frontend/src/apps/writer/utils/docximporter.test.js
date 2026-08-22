import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { TabsExtension, tabsIn } from '@/apps/writer/extensions/tabs'

const uploadMock = vi.fn()
const callMock = vi.fn()
const toastMock = { success: vi.fn(), error: vi.fn() }

vi.mock('frappe-ui', () => ({
  call: (...args) => callMock(...args),
  useFileUpload: () => ({ upload: uploadMock }),
  toast: toastMock,
}))

const convertToHtmlMock = vi.fn()

vi.mock('mammoth', () => ({
  images: { imgElement: (fn) => fn },
  convertToHtml: (...args) => convertToHtmlMock(...args),
}))

const { _normaliseHtml, _convertDocxToHtml, importDocx } = await import('./docximporter')

function parse(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  return div
}

function fakeFile(name) {
  return { name, arrayBuffer: async () => new ArrayBuffer(0) }
}

function makeEditor(content = '') {
  return new Editor({
    extensions: [Document, Paragraph, Text, TabsExtension],
    content,
  })
}

describe('_normaliseHtml', () => {
  it('marks only the first table row as a header', () => {
    const input =
      '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>'
    const rows = parse(_normaliseHtml(input)).querySelectorAll('tr')

    expect(rows[0].querySelectorAll('th')).toHaveLength(2)
    expect(rows[0].querySelectorAll('td')).toHaveLength(0)
    expect(rows[1].querySelectorAll('td')).toHaveLength(2)
  })

  it('demotes every row but the first when mammoth marks the whole table as header', () => {
    const input =
      '<table><tbody><tr><th>A</th><th>B</th></tr><tr><th>C</th><th>D</th></tr></tbody></table>'
    const rows = parse(_normaliseHtml(input)).querySelectorAll('tr')

    expect(rows[0].querySelectorAll('th')).toHaveLength(2)
    expect(rows[1].querySelectorAll('th')).toHaveLength(0)
    expect(rows[1].querySelectorAll('td')).toHaveLength(2)
  })

  it('strips bold formatting inside table cells', () => {
    const input =
      '<table><tbody><tr><td><strong>Header</strong></td></tr><tr><td><b>Body</b></td></tr></tbody></table>'
    const out = parse(_normaliseHtml(input))

    expect(out.querySelector('strong, b')).toBeNull()
    expect(out.textContent).toContain('Header')
    expect(out.textContent).toContain('Body')
  })

  it('pads an empty cell with a paragraph so the editor schema accepts it', () => {
    const input = '<table><tbody><tr><td></td></tr></tbody></table>'
    const cell = parse(_normaliseHtml(input)).querySelector('th, td')

    expect(cell.children).toHaveLength(1)
    expect(cell.children[0].tagName).toBe('P')
  })

  it('strips inline event handler attributes', () => {
    const input = '<p onmouseover="alert(1)">hi</p>'
    const out = parse(_normaliseHtml(input))

    expect(out.querySelector('p').hasAttribute('onmouseover')).toBe(false)
  })

  it('removes unsafe link protocols but keeps ordinary ones', () => {
    const input =
      '<p><a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a></p>'
    const links = parse(_normaliseHtml(input)).querySelectorAll('a')

    expect(links[0].hasAttribute('href')).toBe(false)
    expect(links[1].getAttribute('href')).toBe('https://example.com')
  })

  it('removes script and other unsafe elements entirely', () => {
    const input = '<div><script>alert(1)</script><p>safe</p><iframe src="x"></iframe></div>'
    const out = parse(_normaliseHtml(input))

    expect(out.querySelector('script, iframe')).toBeNull()
    expect(out.textContent).toContain('safe')
  })

  it('leaves ordinary text formatting and structure outside tables untouched', () => {
    const input =
      '<h1>Title</h1><p><strong>bold</strong> and <em>italic</em></p><ul><li>one</li><li>two</li></ul>'

    // Bold-stripping only applies inside table cells; everywhere else is
    // passed through as mammoth produced it.
    expect(_normaliseHtml(input)).toBe(input)
  })
})

describe('_convertDocxToHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('converts a docx to normalised HTML and returns mammoth messages', async () => {
    convertToHtmlMock.mockResolvedValue({
      value: '<p><strong>hi</strong></p><table><tr><td>A</td></tr></table>',
      messages: [{ type: 'warning', message: "A cross-reference could not be resolved" }],
    })

    const { html, messages } = await _convertDocxToHtml(fakeFile('sample.docx'), 'file-1', [])

    // Paragraph formatting is untouched; the table went through normalisation
    // (its lone cell became a header row), proving this really is the same
    // pipeline _normaliseHtml is tested against above.
    expect(html).toContain('<strong>hi</strong>')
    expect(parse(html).querySelector('th')).not.toBeNull()
    expect(messages).toEqual([{ type: 'warning', message: "A cross-reference could not be resolved" }])
  })

  it('passes the file bytes to mammoth as an arrayBuffer', async () => {
    convertToHtmlMock.mockResolvedValue({ value: '<p>x</p>', messages: [] })
    const file = fakeFile('sample.docx')

    await _convertDocxToHtml(file, 'file-1', [])

    const [input] = convertToHtmlMock.mock.calls[0]
    expect(input.arrayBuffer).toBeInstanceOf(ArrayBuffer)
  })

  it('uploads each embedded image and rewrites its src into the returned HTML', async () => {
    uploadMock.mockResolvedValue({
      file_url: '/api/method/suite.writer.api.embed.get?id=embed-1',
    })
    const uploaded = []
    convertToHtmlMock.mockImplementation(async (_input, options) => {
      const { src } = await options.convertImage({
        readAsArrayBuffer: async () => new ArrayBuffer(1),
        contentType: 'image/png',
      })
      return { value: `<p><img src="${src}"></p>`, messages: [] }
    })

    const { html } = await _convertDocxToHtml(fakeFile('sample.docx'), 'file-1', uploaded)

    expect(uploadMock).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        params: { file_id: 'file-1' },
        upload_endpoint: '/api/method/suite.writer.api.embed.add',
      }),
    )
    expect(html).toContain('src="/api/method/suite.writer.api.embed.get?id=embed-1"')
    // The embed id is recorded so a later failure could still roll it back.
    expect(uploaded).toEqual(['embed-1'])
  })

  it('names the uploaded file using the image content type', async () => {
    uploadMock.mockResolvedValue({ file_url: '/api/method/suite.writer.api.embed.get?id=embed-2' })
    convertToHtmlMock.mockImplementation(async (_input, options) => {
      await options.convertImage({
        readAsArrayBuffer: async () => new ArrayBuffer(1),
        contentType: 'image/jpeg',
      })
      return { value: '<p>done</p>', messages: [] }
    })

    await _convertDocxToHtml(fakeFile('sample.docx'), 'file-1', [])

    const [uploadedFile] = uploadMock.mock.calls[0]
    expect(uploadedFile.name).toBe('image.jpg')
  })

  it('propagates a conversion failure for a malformed/invalid docx', async () => {
    convertToHtmlMock.mockRejectedValue(new Error('End of central directory record signature not found'))

    await expect(_convertDocxToHtml(fakeFile('corrupt.docx'), 'file-1', [])).rejects.toThrow(
      'End of central directory record signature not found',
    )
  })
})

describe('importDocx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts directly into an empty document', async () => {
    convertToHtmlMock.mockResolvedValue({ value: '<p>Imported text</p>', messages: [] })
    const editor = makeEditor('')

    await importDocx(fakeFile('sample.docx'), { editor: { value: editor }, currentFileId: 'file-1' })

    expect(editor.getText()).toContain('Imported text')
    expect(tabsIn(editor.state.doc)).toHaveLength(0)
    expect(toastMock.success).toHaveBeenCalled()
  })

  it('creates a new tab for a non-empty document, preserving existing content', async () => {
    convertToHtmlMock.mockResolvedValue({ value: '<p>Imported text</p>', messages: [] })
    const editor = makeEditor('<p>Original text</p>')

    await importDocx(fakeFile('sample.docx'), { editor: { value: editor }, currentFileId: 'file-1' })

    expect(tabsIn(editor.state.doc)).toHaveLength(2)
    expect(editor.getText()).toContain('Original text')
    expect(editor.getText()).toContain('Imported text')
  })

  it('shows an error and makes no changes when there is no convertible content', async () => {
    convertToHtmlMock.mockResolvedValue({ value: '', messages: [] })
    const editor = makeEditor('<p>Original text</p>')

    await importDocx(fakeFile('sample.docx'), { editor: { value: editor }, currentFileId: 'file-1' })

    expect(toastMock.error).toHaveBeenCalled()
    expect(tabsIn(editor.state.doc)).toHaveLength(0)
    expect(editor.getText()).toBe('Original text')
  })

  it('inserts the converted HTML into the document, preserving structure and order', async () => {
    convertToHtmlMock.mockResolvedValue({
      value: '<p>First imported paragraph</p><p>Second imported paragraph</p>',
      messages: [],
    })
    const editor = makeEditor('')

    await importDocx(fakeFile('sample.docx'), { editor: { value: editor }, currentFileId: 'file-1' })

    const texts = [...parse(editor.getHTML()).querySelectorAll('p')]
      .map((p) => p.textContent)
      .filter(Boolean)
    expect(texts).toEqual(['First imported paragraph', 'Second imported paragraph'])
  })

  it('shows an error and makes no changes for a malformed or invalid docx file', async () => {
    convertToHtmlMock.mockRejectedValue(new Error('End of central directory record signature not found'))
    const editor = makeEditor('<p>Original text</p>')

    await importDocx(fakeFile('corrupt.docx'), { editor: { value: editor }, currentFileId: 'file-1' })

    expect(toastMock.error).toHaveBeenCalled()
    expect(callMock).not.toHaveBeenCalled() // nothing was uploaded, so nothing to roll back
    expect(tabsIn(editor.state.doc)).toHaveLength(0)
    expect(editor.getText()).toBe('Original text')
  })

  it('reports success when mammoth only returns non-error messages', async () => {
    convertToHtmlMock.mockResolvedValue({
      value: '<p>Imported text</p>',
      messages: [{ type: 'warning', message: 'A style was not mapped and was ignored' }],
    })
    const editor = makeEditor('')

    await importDocx(fakeFile('sample.docx'), { editor: { value: editor }, currentFileId: 'file-1' })

    expect(toastMock.success).toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('reports a partial import when mammoth returns an error message', async () => {
    convertToHtmlMock.mockResolvedValue({
      value: '<p>Imported text</p>',
      messages: [{ type: 'error', message: "Could not find image file 'media/image1.png'" }],
    })
    const editor = makeEditor('')

    await importDocx(fakeFile('sample.docx'), { editor: { value: editor }, currentFileId: 'file-1' })

    // The content mammoth did manage to convert is still inserted...
    expect(editor.getText()).toContain('Imported text')
    // ...but the user is told the import was incomplete, not a full success.
    expect(toastMock.error).toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('deletes already-uploaded images when the import fails partway through', async () => {
    uploadMock.mockResolvedValue({
      file_url: '/api/method/suite.writer.api.embed.get?id=embed-1',
    })
    convertToHtmlMock.mockImplementation(async (_input, options) => {
      await options.convertImage({
        readAsArrayBuffer: async () => new ArrayBuffer(1),
        contentType: 'image/png',
      })
      throw new Error('boom')
    })
    const editor = makeEditor('<p>Original text</p>')

    await importDocx(fakeFile('sample.docx'), { editor: { value: editor }, currentFileId: 'file-1' })

    expect(callMock).toHaveBeenCalledWith('suite.drive.api.files.delete_entities', {
      entity_names: ['embed-1'],
    })
    expect(toastMock.error).toHaveBeenCalled()
    expect(editor.getText()).toBe('Original text')
  })
})
