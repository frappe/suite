import { Extension } from '@tiptap/core'

const PIXELS = /^(-?\d+)px$/

// The blocks Drive stored an indent on
export const INDENTED_BLOCKS = ['paragraph', 'heading']

// Drive's default heading line height, which it never drew
export const DRIVE_HEADING_LINE_HEIGHT = '100%'

// Drive wrote an indent only as a px margin with priority; a pasted web margin isn't one
function parseIndent(element: HTMLElement) {
  const found = PIXELS.exec(element.style.marginLeft)
  const isDrives = element.style.getPropertyPriority('margin-left') === 'important'
  if (!found || !isDrives || Number(found[1]) === 0) {
    return null
  }

  return Number(found[1])
}

function renderIndent(attrs: Record<string, unknown>) {
  if (attrs.indent === null) {
    return {}
  }

  return { style: `margin-left: ${attrs.indent}px!important;` }
}

function parseLineHeight(element: HTMLElement) {
  const height = element.style.lineHeight
  if (!height || height === DRIVE_HEADING_LINE_HEIGHT) {
    return null
  }

  return height
}

function renderLineHeight(attrs: Record<string, unknown>) {
  if (!attrs.lineHeight) {
    return {}
  }

  return { style: `line-height: ${attrs.lineHeight}` }
}

// Drive's indent on paragraphs and headings, and its heading line height, drawn as Drive drew them
export const BlockLayout = Extension.create({
  name: 'blockLayout',

  addGlobalAttributes() {
    return [
      {
        types: INDENTED_BLOCKS,
        attributes: {
          indent: { default: null, parseHTML: parseIndent, renderHTML: renderIndent },
        },
      },
      {
        types: ['heading'],
        attributes: {
          lineHeight: { default: null, parseHTML: parseLineHeight, renderHTML: renderLineHeight },
        },
      },
    ]
  },
})
