/**
 * Writer's downloads: the document as a Word file or as Markdown, and a
 * version as HTML. The
 * converters load on first use, so opening a document does not pay for them.
 */
import type { Editor } from '@tiptap/core'

import type { DocumentSession } from '@/apps/drive'
import { embedUrl } from '@/apps/writer/drive'
import { mediaNodeId } from '@/apps/writer/extensions/drive-media'
import { currentTabHTML } from '@/apps/writer/extensions/tabs'
import type { PictureFetch } from '@/apps/writer/utils/docxexporter'

type MediaFetch = DocumentSession['credentials']['fetch']

/** Which part of a document a download takes. */
export type ExportScope = 'document' | 'tab'

const MEDIA_EXTENSIONS = new Map<string, string>(
  Object.entries({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
  }),
)

export interface MarkdownExport {
  markdown: string
  /** The pictures the Markdown links, each at its relative path. */
  media: { path: string; blob: Blob }[]
}

export function exportHTML(editor: Editor, scope: ExportScope): string {
  return scope === 'tab' ? currentTabHTML(editor) : editor.getHTML()
}

/** Saves `html` as `<name>.html`. */
export async function downloadHTML(html: string, name: string): Promise<void> {
  const { saveAs } = await import('file-saver')
  const stem = fileStem(name)
  saveAs(new Blob([html], { type: 'text/html;charset=utf-8' }), `${stem}.html`)
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
    return fetchMedia(embedUrl(id))
  }
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
    const path = `images/${media.length + 1}.${MEDIA_EXTENSIONS.get(blob.type) ?? 'png'}`
    image.setAttribute('src', path)
    media.push({ path, blob })
  }

  const { markdownOf } = await import('@/apps/writer/collab/markdown')
  return { markdown: markdownOf(page.body), media }
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
