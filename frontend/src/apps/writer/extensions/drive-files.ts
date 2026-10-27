import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { driveNodeRoute, nodeContentUrl, type DriveNodeSummary } from '@/apps/drive'
import { translate as __ } from '@/platform/translation'

/** A file or document picked from Drive. */
export type DriveFile = Pick<DriveNodeSummary, 'name' | 'title' | 'kind' | 'mime'>

/** Opens Drive's file picker. Resolves with the picked file, or `undefined` when cancelled. */
export type PickDriveFile = () => Promise<DriveFile | undefined>

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    driveFiles: {
      /** Pick a file from Drive and insert it at the selection. */
      insertFromDrive: () => ReturnType
    }
  }
}

const CONTENT_URL = /^\/api\/suite\/drive\/nodes\/[^/?#]+\/content$/

/**
 * How a Drive file goes into a document. A picture or a video shows the file
 * itself, through Drive's content URL, so each reader loads it with their own
 * Drive access. Anything else is a link to the file, named by its title.
 */
export function driveFileContent(file: DriveFile): JSONContent {
  const src = nodeContentUrl(file.name)
  const media = file.kind === 'file' ? file.mime?.split('/')[0] : undefined
  if (media === 'image') return { type: 'image', attrs: { src, alt: file.title } }
  if (media === 'video') return { type: 'video', attrs: { src, title: file.title } }
  const href = driveNodeRoute(file).path
  return { type: 'text', text: file.title, marks: [{ type: 'link', attrs: { href } }] }
}

/** Inserts `file` at the selection. A link to it wraps selected text instead of adding its title. */
export function insertDriveFile(editor: Editor, file: DriveFile): boolean {
  const content = driveFileContent(file)
  const link = content.marks?.[0]
  if (link && !editor.state.selection.empty)
    return editor
      .chain()
      .focus()
      .setLink({ href: String(link.attrs?.href) })
      .run()
  return editor.chain().focus().insertContent(content).run()
}

/**
 * Inserts files from Drive, and shows a placeholder in place of a Drive
 * picture or video the reader cannot load, so the page keeps its layout.
 */
export const DriveFiles = Extension.create<{ pickFile: PickDriveFile | null }>({
  name: 'driveFiles',

  addOptions() {
    return { pickFile: null }
  },

  addCommands() {
    return {
      insertFromDrive:
        () =>
        ({ editor, dispatch }) => {
          const pickFile = this.options.pickFile
          if (!pickFile) return false
          if (dispatch) void pickFile().then((file) => file && insertDriveFile(editor, file))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('driveFiles'),
        view: (view) => {
          // `error` does not bubble, so it is caught on the way down.
          view.dom.addEventListener('error', showUnavailable, true)
          // A file can fail before this view exists.
          for (const element of view.dom.querySelectorAll('img, video'))
            if (hasFailed(element)) showUnavailable({ target: element })
          return { destroy: () => view.dom.removeEventListener('error', showUnavailable, true) }
        },
      }),
    ]
  },
})

function hasFailed(element: Element): boolean {
  if (element instanceof HTMLImageElement) return element.complete && !element.naturalWidth
  return element instanceof HTMLVideoElement && element.error !== null
}

function showUnavailable(event: Pick<Event, 'target'>): void {
  const element = event.target
  if (!(element instanceof HTMLImageElement || element instanceof HTMLVideoElement)) return
  if (!CONTENT_URL.test(element.getAttribute('src') ?? '')) return
  element.setAttribute('data-media-state', 'unavailable')
  const placeholder = unavailablePicture(element)
  if (element instanceof HTMLImageElement) {
    element.src = placeholder
    return
  }
  element.removeAttribute('src')
  element.controls = false
  element.poster = placeholder
}

/** A box with a note, in the editor's colours. It takes the size of the element it fills. */
function unavailablePicture(element: Element): string {
  const style = getComputedStyle(element)
  const fill = style.getPropertyValue('--surface-gray-2').trim() || '#f3f3f3'
  const ink = style.getPropertyValue('--ink-gray-5').trim() || '#7c7c7c'
  const note = escapeXml(__('This Drive file is not available to you'))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">` +
    `<rect width="100%" height="100%" fill="${fill}"/>` +
    `<text x="50%" y="50%" fill="${ink}" font-family="system-ui, sans-serif" font-size="14" ` +
    `text-anchor="middle" dominant-baseline="middle">${note}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (char) => `&#${char.charCodeAt(0)};`)
}
