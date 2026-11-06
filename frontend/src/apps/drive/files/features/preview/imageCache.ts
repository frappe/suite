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

/** Keeps the images for `urls`, loading any not yet kept, and lets every other go. */
export function keepImages(urls: readonly string[]): void {
  for (const url of urls) previewImage(url)
  for (const url of kept.keys()) if (!urls.includes(url)) kept.delete(url)
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
