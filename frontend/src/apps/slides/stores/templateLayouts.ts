import { toRaw } from 'vue'
import type * as Y from 'yjs'

import type { GetTemplatesOutputTemplate } from '@/apps/slides/client/generated'
import { drawnSlides } from '@/apps/slides/collab/drawnDeck'
import { templateList } from '@/apps/slides/stores/presentation'

// Light and Dark open with two cover layouts, so a new presentation starts from the third,
// as the server's `first_layout` does
const SYSTEM_TEMPLATES = new Set(['Light', 'Dark'])
const SYSTEM_TEMPLATE_FIRST_LAYOUT = 2

/** The layout a new presentation taking this template starts from. */
export function firstLayout<Layout>(template: { title: string; layouts: Layout[] }): Layout {
  const { title, layouts } = template
  const isSystem = SYSTEM_TEMPLATES.has(title) && layouts.length > SYSTEM_TEMPLATE_FIRST_LAYOUT
  return layouts[isSystem ? SYSTEM_TEMPLATE_FIRST_LAYOUT : 0]
}

type ReadSaved = (nodeId: string) => Promise<Y.Doc | null>

let readSaved: ReadSaved | null = null
// one read per listed template; a failed one is forgotten, so the next need tries again
const drawings = new WeakMap<GetTemplatesOutputTemplate, Promise<void>>()

/** The surface hands over how to read a saved presentation, since the stores hold no credentials. */
export function setTemplateReader(read: ReadSaved) {
  readSaved = read
  return () => {
    if (readSaved === read) {
      readSaved = null
    }
  }
}

/** Draws the named converted templates' layouts from their saved slides, or every one's with no names. */
export async function drawTemplateLayouts(names?: string[]) {
  const templates = templateList.value.filter(
    (template) => template.is_converted && (!names || names.includes(template.name)),
  )
  await Promise.all(templates.map(drawOnce))
}

function drawOnce(template: GetTemplatesOutputTemplate) {
  const read = readSaved
  if (!read) {
    return
  }

  const listed = toRaw(template)
  let drawing = drawings.get(listed)
  if (!drawing) {
    drawing = read(template.node)
      .then((doc) => {
        const slides = doc ? drawnSlides(doc) : []
        // SAFETY: a drawn slide carries a row's fields under their row names, its elements as a list
        template.layouts = withPictures(slides, template.thumbnails) as typeof template.layouts
      })
      .catch(() => {
        drawings.delete(listed)
      })
    drawings.set(listed, drawing)
  }
  return drawing
}

// The pictures are numbered by slide, so once the saved slides no longer match them one for
// one, a picture may show another slide: every layout is drawn instead
function withPictures<Slide extends object>(slides: Slide[], pictures: string[]) {
  const isPictured = pictures.length === slides.length
  return slides.map((slide, at) => ({ ...slide, thumbnail: isPictured ? pictures[at] : '' }))
}
