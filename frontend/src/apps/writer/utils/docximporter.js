import { v4 as uuidv4 } from 'uuid'
import { call, useFileUpload, toast as nToast } from 'frappe-ui'
import { tabsIn, findTab } from '@/apps/writer/extensions/tabs'

const IMAGE_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
}

// Upload an image found in the DOCX to the same endpoint the editor uses for
// pasted images, so it becomes a real file instead of inline base64. Each new
// embed is recorded in `uploaded` so a failed import can delete them again.
async function _uploadImage(element, fileId, uploaded) {
  const buffer = await element.readAsArrayBuffer()
  const ext = IMAGE_EXTENSIONS[element.contentType] || 'png'
  const file = new File([buffer], `image.${ext}`, {
    type: element.contentType || 'application/octet-stream',
  })
  const fileUpload = useFileUpload()
  const result = await fileUpload.upload(file, {
    params: { file_id: fileId },
    upload_endpoint: '/api/method/suite.writer.api.embed.add',
  })
  const id = new URLSearchParams(result.file_url.split('?')[1]).get('id')
  if (id) uploaded.push(id)
  return { src: result.file_url }
}

// An import uploads images before the content is inserted, so a failure part
// way through would leave files nothing points at. Delete them again.
async function _discardUploads(uploaded) {
  if (!uploaded.length) return
  try {
    await call('suite.drive.api.files.delete_entities', { entity_names: uploaded })
  } catch (e) {
    console.error('Could not remove images from the failed import:', e)
  }
}

// Make only the first row a header, like a manually created table. Mammoth
// marks either no row or every row as header, and an all-header table also
// makes "toggle header row" skip the first cell.
function _normaliseHeaderRow(table) {
  Array.from(table.rows).forEach((row, index) => {
    const wanted = index === 0 ? 'TH' : 'TD'
    for (const cell of Array.from(row.cells)) {
      if (cell.tagName === wanted) continue
      const replacement = document.createElement(wanted)
      for (const attr of Array.from(cell.attributes)) {
        replacement.setAttribute(attr.name, attr.value)
      }
      replacement.innerHTML = cell.innerHTML
      cell.replaceWith(replacement)
    }
  })
}

// Word often bolds every cell. A manually created table has no bold of its
// own — its header looks bold only because the theme styles <th>. Remove
// Word's bold so both tables look the same.
function _stripCellEmphasis(table) {
  for (const cell of Array.from(table.querySelectorAll('th, td'))) {
    for (const bold of Array.from(cell.querySelectorAll('strong, b'))) {
      bold.replaceWith(...bold.childNodes)
    }
  }
}

// Link targets are the one thing a .docx controls that we pass straight
// through, so allow only ordinary link protocols. The editor schema drops
// unsafe markup too, but this way the imported HTML is safe on its own.
const SAFE_LINK = /^(?:https?|mailto|tel|ftp|ftps|sms|xmpp):|^[#/]/i

function _sanitise(container) {
  for (const el of Array.from(container.querySelectorAll('*'))) {
    for (const { name } of Array.from(el.attributes)) {
      if (name.toLowerCase().startsWith('on')) el.removeAttribute(name)
    }
  }
  for (const link of Array.from(container.querySelectorAll('a[href]'))) {
    if (!SAFE_LINK.test(link.getAttribute('href').trim())) link.removeAttribute('href')
  }
  for (const el of Array.from(container.querySelectorAll('script, style, iframe, object, embed'))) {
    el.remove()
  }
}

// A blank Word cell, or one whose only content was emphasis stripped down to
// nothing above, has no block content left. The editor's table schema
// requires every cell to contain at least one block, so insertion fails
// with "Invalid content for node tableHeader: <>" unless we pad it back in.
function _ensureCellContent(table) {
  for (const cell of Array.from(table.querySelectorAll('th, td'))) {
    if (cell.children.length) continue
    const p = document.createElement('p')
    p.append(...cell.childNodes)
    cell.appendChild(p)
  }
}

// Clean the converted HTML, and give imported tables the same structure as
// manually created ones: one header row, no bold, no width attributes. The
// theme then styles them the same.
export function _normaliseHtml(html) {
  const container = document.createElement('div')
  container.innerHTML = html
  _sanitise(container)
  for (const table of Array.from(container.querySelectorAll('table'))) {
    _normaliseHeaderRow(table)
    _stripCellEmphasis(table)
    _ensureCellContent(table)
  }
  return container.innerHTML
}

// Parses a .docx into HTML entirely in the browser (via mammoth).
export async function _convertDocxToHtml(file, fileId, uploaded) {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const { value: html, messages } = await mammoth.convertToHtml(
    { arrayBuffer },
    { convertImage: mammoth.images.imgElement((el) => _uploadImage(el, fileId, uploaded)) },
  )
  return { html: html ? _normaliseHtml(html) : html, messages }
}

function _insertAtEnd(editor, html) {
  editor.chain().focus().insertContentAt(editor.state.doc.content.size, html).run()
}

// Put the imported content in a new tab. If the document has no tabs yet, its
// current content is moved into one first so nothing already written is lost.
// createTab() focuses the new tab by itself.
function _insertInNewTab(editor, html, label) {
  if (!tabsIn(editor.state.doc).length) editor.commands.wrapInTab()
  const id = uuidv4()
  editor.commands.createTab({ id, label })
  const tab = findTab(editor.state.doc, id)
  if (!tab) return _insertAtEnd(editor, html) // shouldn't happen; don't lose content
  // createTab() adds an empty paragraph — swap it for the imported content.
  editor.commands.insertContentAt(
    { from: tab.pos + 1, to: tab.pos + tab.node.nodeSize - 1 },
    html,
  )
}

/**
 * Import a .docx into the open document. An empty document takes the content
 * directly; otherwise it goes into a new tab so existing work is untouched.
 */
export async function importDocx(file, { editor, currentFileId }) {
  const ed = editor.value
  if (!ed) return
  // Images are uploaded while converting, so anything that fails after that
  // has to take its uploads back down with it.
  const uploaded = []
  try {
    const { html, messages } = await _convertDocxToHtml(file, currentFileId, uploaded)
    if (!html) {
      await _discardUploads(uploaded)
      nToast.error('The document appears to be empty.')
      return
    }
    if (ed.isEmpty) _insertAtEnd(ed, html)
    else _insertInNewTab(ed, html, file.name.replace(/\.docx$/i, ''))

    if (messages?.some((m) => m.type === 'error')) {
      nToast.error('Document imported, but some content could not be converted.')
    } else {
      nToast.success('Document imported successfully.')
    }
  } catch (e) {
    console.error(e)
    await _discardUploads(uploaded)
    nToast.error('Failed to import DOCX file.')
  }
}
