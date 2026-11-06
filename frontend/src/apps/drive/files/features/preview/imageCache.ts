/**
 * Image elements the file preview keeps, by URL, so a step to the next or
 * previous image shows one already loaded. A file's content URL answers with a
 * fresh signed address each time, so the browser's cache cannot do this.
 */
const kept = new Map<string, HTMLImageElement>()
/** Previews on screen. The host swaps one for the next, so the last one leaving clears the cache only if no other comes. */
let holders = 0

/** The kept element for `url`, loading it now if it is not kept. A failed load is let go, so the next show tries again. */
export function previewImage(url: string): HTMLImageElement {
  const known = kept.get(url)
  if (known) return known
  const image = document.createElement('img')
  image.decoding = 'async'
  image.addEventListener('error', () => kept.get(url) === image && kept.delete(url), { once: true })
  image.src = url
  kept.set(url, image)
  return image
}

let keeps = 0

/**
 * Keeps the picture on screen and the ones `beside` it, and lets every other
 * go. The pictures beside load once the one on screen has, so they do not
 * slow it down.
 */
export function keepImages(shown: string | null, beside: readonly string[]): void {
  const keep = ++keeps
  const urls = shown ? [shown, ...beside] : beside
  for (const url of kept.keys()) if (!urls.includes(url)) kept.delete(url)
  const loadBeside = () => keep === keeps && beside.forEach(previewImage)
  const image = shown ? previewImage(shown) : null
  if (!image || image.complete) return void loadBeside()
  image.addEventListener('load', loadBeside, { once: true })
  image.addEventListener('error', loadBeside, { once: true })
}

/** Marks a preview on screen. The returned function marks it gone. */
export function holdImages(): () => void {
  holders += 1
  return () => {
    holders -= 1
    queueMicrotask(() => {
      if (!holders) kept.clear()
    })
  }
}
