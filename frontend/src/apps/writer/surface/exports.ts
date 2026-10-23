/**
 * Writer's downloads: the document as a Word file or as Markdown. The
 * converters load on first use, so opening a document does not pay for them.
 */
import type { Editor } from '@tiptap/core'
import type TurndownService from 'turndown'

import type { DocumentSession } from '@/apps/drive'
import { mediaNodeId } from '@/apps/writer/extensions/drive-media'
import { currentTabHTML } from '@/apps/writer/extensions/tabs'
import type { PictureFetch } from '@/apps/writer/utils/docxexporter'

type MediaFetch = DocumentSession['credentials']['fetch']

/** Which part of a document a download takes. */
export type ExportScope = 'document' | 'tab'

const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
}

export interface MarkdownExport {
  markdown: string
  /** The pictures the Markdown links, each at its relative path. */
  media: { path: string; blob: Blob }[]
}

export function exportHTML(editor: Editor, scope: ExportScope): string {
  return scope === 'tab' ? currentTabHTML(editor) : editor.getHTML()
}

/** A file name stem without the characters a file system refuses. */
function fileStem(title: string): string {
  return title.replace(/[<>:"/\\|?*]/g, '').trim() || 'Document'
}

/**
 * Fetches the picture an `<img>` shows. A picture stored in Drive goes
 * through the session's credentials, so a share link's secret reaches Drive;
 * any other is fetched from its `src` as the browser would.
 */
function pictureFetch(fetchMedia: MediaFetch): PictureFetch {
  return (image) => {
    const src = image.getAttribute('src') ?? ''
    const id = mediaNodeId(src, image.getAttribute('data-node'))
    if (!id) return fetch(src)
    return fetchMedia(`/api/method/suite.writer.api.embed.get?id=${encodeURIComponent(id)}`)
  }
}

/**
 * A table as GitHub-flavoured Markdown: the first row is the heading row,
 * every other row a body row. Written for the editor's own tables, which
 * have one block per cell at most, so a cell's paragraphs are joined with
 * `<br>`; a cell that spans columns is followed by as many empty cells.
 */
function tableRule(turndown: TurndownService): void {
  const cells = (tr: HTMLTableRowElement): string[] =>
    [...tr.cells].flatMap((node) => {
      const text = turndown
        .turndown(node.innerHTML)
        .trim()
        .replace(/\n{2,}/g, '<br>')
        .replace(/\n/g, ' ')
      return [text.replace(/\|/g, '\\|'), ...Array<string>(Math.max(0, node.colSpan - 1)).fill('')]
    })
  const line = (row: string[]): string => `| ${row.join(' | ')} |`
  turndown.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = [...(node as HTMLTableElement).rows].map(cells)
      const heading = rows.shift()
      if (!heading) return ''
      const divider = heading.map(() => '---')
      return `\n\n${[heading, divider, ...rows].map(line).join('\n')}\n\n`
    },
  })
  // Cells are rendered by the table rule; keep their text out of the default output.
  turndown.addRule('tableCell', {
    filter: ['th', 'td', 'tr', 'thead', 'tbody'],
    replacement: (content) => content,
  })
}

/**
 * The document as Markdown. Each picture stored in Drive is fetched and saved
 * as `images/<n>.<ext>`, and the Markdown links it by that relative path. A
 * picture that cannot be fetched keeps its stored link.
 */
export async function toMarkdown(html: string, fetchMedia: MediaFetch): Promise<MarkdownExport> {
  // A parsed document is inert: its pictures do not start loading.
  const page = new DOMParser().parseFromString(html, 'text/html')
  const media: MarkdownExport['media'] = []
  const fetchPicture = pictureFetch(fetchMedia)
  for (const image of page.body.querySelectorAll('img')) {
    if (!mediaNodeId(image.getAttribute('src'), image.getAttribute('data-node'))) continue
    const response = await fetchPicture(image).catch(() => null)
    if (!response?.ok) continue
    const blob = await response.blob()
    const path = `images/${media.length + 1}.${MEDIA_EXTENSIONS[blob.type] ?? 'png'}`
    image.setAttribute('src', path)
    media.push({ path, blob })
  }

  const { default: TurndownService } = await import('turndown')
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  tableRule(turndown)
  return { markdown: turndown.turndown(page.body), media }
}

/** Saves `<title>.md`, or `<title>.zip` with the Markdown and its pictures when it has any. */
export async function downloadMarkdown(
  html: string,
  title: string,
  fetchMedia: MediaFetch,
): Promise<void> {
  const [{ markdown, media }, { saveAs }] = await Promise.all([
    toMarkdown(html, fetchMedia),
    import('file-saver'),
  ])
  const stem = fileStem(title)
  const text = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  if (!media.length) {
    saveAs(text, `${stem}.md`)
    return
  }
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file(`${stem}.md`, text)
  for (const { path, blob } of media) zip.file(path, blob)
  saveAs(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${stem}.zip`)
}

/**
 * Saves `<title>.docx`, laid out with the document's font and spacing
 * settings. Pictures stored in Drive are fetched with the session's
 * credentials, as the Markdown download does.
 */
export async function downloadDocx(
  html: string,
  title: string,
  settings: Record<string, unknown>,
  fetchMedia: MediaFetch,
): Promise<void> {
  const { downloadDocxFromHtml } = await import('@/apps/writer/utils/docxexporter')
  await downloadDocxFromHtml(html, `${fileStem(title)}.docx`, settings, pictureFetch(fetchMedia))
}
