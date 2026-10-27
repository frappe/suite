import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const HEADINGS = 'h1, h2, h3, h4, h5, h6'
// A link shows as one already; the source's colour and underline would stay once it is removed.
const LINK_LOOK = ['color', 'text-decoration', 'text-decoration-line']

/**
 * Pasted text takes the document's look:
 * - Rich text from outside Writer, such as Google Docs or Word, loses its font,
 *   its line height and paragraph spacing, its heading sizes, and its body size:
 *   the size most of the pasted text has. Other sizes, such as a larger line in
 *   the body, are kept in pixels. Colours are kept, except on links; the colour
 *   mark already snaps them to the palette and drops black. Links lose their
 *   underline too.
 * - Mod-Shift-v pastes the text as it is, without reading Markdown in it.
 */
export const WriterPaste = Extension.create({
  name: 'writerPaste',
  // Ahead of frappe-ui's content paste, which reads Markdown in plain text.
  priority: 101,

  addProseMirrorPlugins() {
    let isPlain = false
    return [
      new Plugin({
        key: new PluginKey('writerPaste'),
        props: {
          handleKeyDown: (_view, event) => {
            isPlain = isPlainPaste(event)
            return false
          },
          handlePaste: (view, _event, slice) => {
            if (!isPlain) return false
            isPlain = false
            // The editor read the clipboard as plain text, since Shift was down.
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
            return true
          },
          transformPastedHTML: (html) => withDocumentLook(html),
        },
      }),
    ]
  },
})

function isPlainPaste(event: KeyboardEvent): boolean {
  const isMod = event.metaKey || event.ctrlKey
  return isMod && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'v'
}

/** `html` from outside Writer without the styles that would set it apart from the document. */
export function withDocumentLook(html: string): string {
  // Writer marks what it copies; that keeps the formatting it was given here.
  if (html.includes('data-pm-slice')) return html
  const template = document.createElement('template')
  template.innerHTML = html
  const styled = [...template.content.querySelectorAll<HTMLElement>('[style]')]
  const bodySize = mostUsedFontSize(styled)
  for (const element of styled) {
    const { style } = element
    for (const property of ['font-family', 'line-height', 'margin-top', 'margin-bottom'])
      style.removeProperty(property)
    if (style.fontSize === bodySize || element.closest(HEADINGS)) style.removeProperty('font-size')
    else if (style.fontSize.endsWith('pt')) style.fontSize = pointsToPixels(style.fontSize)
    if (element.closest('a')) for (const property of LINK_LOOK) style.removeProperty(property)
  }
  for (const underline of template.content.querySelectorAll('a u'))
    underline.replaceWith(...underline.childNodes)
  return template.innerHTML
}

/** The font size that the most characters have, weighed by the text each element holds. */
function mostUsedFontSize(elements: HTMLElement[]): string | undefined {
  const characters = new Map<string, number>()
  for (const element of elements) {
    const size = element.style.fontSize
    if (size && !element.closest(HEADINGS))
      characters.set(size, (characters.get(size) ?? 0) + (element.textContent?.length ?? 0))
  }
  return [...characters].sort(([, a], [, b]) => b - a)[0]?.[0]
}

function pointsToPixels(size: string): string {
  return `${Math.round((parseFloat(size) * 96) / 72)}px`
}
