import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { translate as __ } from '@/platform/translation/translate'

/**
 * Opens Drive's file picker. Resolves with the picked file as document content, or
 * `undefined` when cancelled. The caller supplies it because this extension is in the
 * server's converter bundle, which must not load Drive's interface.
 */
export type PickDriveFile = () => Promise<JSONContent | undefined>

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    driveFiles: {
      /** Pick a file from Drive and insert it at the selection. */
      insertFromDrive: () => ReturnType
    }
  }
}

const CONTENT_URL = /^\/api\/suite\/drive\/nodes\/[^/?#]+\/content$/

/** Inserts `content` at the selection. A link to a file wraps selected text instead of adding its title. */
function insertDriveFile(editor: Editor, content: JSONContent): boolean {
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
          if (dispatch)
            void pickFile().then((content) => content && insertDriveFile(editor, content))
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
