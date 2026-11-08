/**
 * Image elements the file preview keeps, by URL, so a step to the next or
 * previous image shows one already loaded. A file's content URL answers with a
 * fresh signed address each time, so the browser's cache cannot do this.
 */
const kept = new Map<string, HTMLImageElement>()
/** Counts `keepImages` calls, so an older call's pending work and a release can tell a newer one came. */
let keeps = 0

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

/**
 * Lets every picture go once the preview has left. The host swaps one preview
 * for the next in the same tick and the next calls `keepImages` in its setup,
 * so a step keeps the pictures it needs.
 */
export function releaseImages(): void {
  const keep = keeps
  queueMicrotask(() => {
    if (keep === keeps) kept.clear()
  })
}
