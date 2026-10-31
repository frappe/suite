import { api } from '@/api'
import { documentSessionUrls } from '@/apps/drive'
import { buildUrl } from '@/platform/transport'

type MediaElement = { type?: string; src?: string; poster?: string }
type Slide = { elements?: MediaElement[] }

export type MediaSource = { slideIndex: number; src: string }

// video bodies stay online, posters come along; a GIF's poster is its sidebar thumbnail
const imageSources = (element: MediaElement): string[] => {
  if (element.type === 'image') return [element.src ?? '', element.poster ?? '']
  if (element.type === 'video') return [element.poster ?? '']
  return []
}

export const collectMediaSources = (slides: Slide[]): MediaSource[] => {
  const seen = new Set<string>()
  const sources: MediaSource[] = []

  slides.forEach((slide, slideIndex) => {
    for (const element of slide.elements || []) {
      for (const src of imageSources(element)) {
        if (!src || seen.has(src)) continue
        seen.add(src)
        sources.push({ slideIndex, src })
      }
    }
  })

  return sources
}

// the reads a /d/<node> page starts with, by the urls the client requests them by
export function startupUrls(
  node: string,
  presentationId: string,
  { readonly, composite }: { readonly: boolean; composite: boolean },
): string[] {
  const urls = [buildUrl(api.slides.documents.get, { name: presentationId })]
  // an editable deck is never composite; the viewer then renders the referenced decks
  if (readonly && composite) {
    urls.push(buildUrl(api.slides.documents.composite, { name: presentationId }))
  }

  urls.push(
    ...documentSessionUrls(node),
    buildUrl(api.suite.account.get, {}),
    buildUrl(api.suite.preferences.get, {}),
    buildUrl(api.suite.translations.get, {}),
  )
  return urls
}

const ENTRY_ASSETS = 'script[type="module"][src], link[rel="modulepreload"], link[rel="stylesheet"]'

// the shell's own script, preloads and styles, from the same build as the shell
export function entryAssets(html: string): string[] {
  return [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll(ENTRY_ASSETS)]
    .map(
      (element) =>
        new URL(element.getAttribute('src') ?? element.getAttribute('href') ?? '', location.origin),
    )
    .filter((url) => url.origin === location.origin)
    .map((url) => url.pathname)
}
