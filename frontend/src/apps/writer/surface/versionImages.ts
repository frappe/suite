import { Doc, XmlElement } from 'yjs'

import type { VersionImage } from '@/apps/drive'
import { BODY_FIELD } from '@/apps/writer/collab'
import { loadVersion } from '@/apps/writer/collab/old-media'
import { mediaNodeId } from '@/apps/writer/extensions/drive-media'

import type { VersionBody } from './versions'

/** The images a version shows, by media node id, each once. */
export function versionImages(body: VersionBody): VersionImage[] {
  let found: VersionImage[]
  if ('html' in body) {
    found = imagesInHTML(body.html)
  } else {
    found = imagesInState(body.state)
  }

  const seen = new Set<string>()
  return found.filter((image) => !seen.has(image.id) && seen.add(image.id))
}

function imagesInHTML(html: string): VersionImage[] {
  const page = new DOMParser().parseFromString(html, 'text/html')
  return [...page.querySelectorAll('[src], [data-node]')].flatMap((element) => {
    const id = mediaNodeId(element.getAttribute('src'), element.getAttribute('data-node'))
    return imageOrNone(id, element.getAttribute('alt'))
  })
}

function imagesInState(state: Uint8Array): VersionImage[] {
  const doc = new Doc()
  try {
    loadVersion(doc, state)
    const elements = doc
      .getXmlFragment(BODY_FIELD)
      .createTreeWalker((node) => node instanceof XmlElement)
    return [...elements].flatMap((element) => {
      if (!(element instanceof XmlElement)) return []
      const attributes: Record<string, unknown> = element.getAttributes()
      const id = mediaNodeId(textOf(attributes.src), textOf(attributes['data-node']))
      return imageOrNone(id, textOf(attributes.alt))
    })
  } finally {
    doc.destroy()
  }
}

function imageOrNone(id: string | null, alt: string | null): VersionImage[] {
  if (!id) {
    return []
  }

  return [{ id, alt: alt ?? '' }]
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
