// every file styles/fonts.css declares
export const bundledFontFiles = [
  'Anton/Anton-Regular-latin',
  'Anton/Anton-Regular-latin-ext',
  'Anton/Anton-Regular-vietnamese',
  'Courier_Prime/CourierPrime-Regular-latin',
  'Courier_Prime/CourierPrime-Regular-latin-ext',
  'Courier_Prime/CourierPrime-Italic-latin',
  'Courier_Prime/CourierPrime-Italic-latin-ext',
  'Courier_Prime/CourierPrime-Bold-latin',
  'Courier_Prime/CourierPrime-Bold-latin-ext',
  'Courier_Prime/CourierPrime-BoldItalic-latin',
  'Courier_Prime/CourierPrime-BoldItalic-latin-ext',
].map((file) => `/assets/suite/slides/fonts/${file}.woff2`)

// A plain fetch so the worker stores them for offline. Through document.fonts a
// stalled file would hold document.fonts.ready, which measuring waits on
export const warmBundledFonts = (): Promise<unknown> =>
  Promise.all(bundledFontFiles.map((url) => fetch(url).then((response) => response.arrayBuffer())))

// a stalled font mustn't hold up print for good
const PRINT_FONT_LIMIT = 3000

function drawnFaces(root: Element) {
  const faces = new Map<string, string>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const { parentElement, textContent } = walker.currentNode
    if (!parentElement || !textContent?.trim()) continue

    const { fontStyle, fontWeight, fontFamily } = getComputedStyle(parentElement)
    const face = `${fontStyle} ${fontWeight} 16px ${fontFamily}`
    faces.set(face, (faces.get(face) ?? '') + textContent)
  }

  return faces
}

// Hidden text starts no font load, so print would draw it in a fallback
export const drawnFontsLoaded = (root: Element): Promise<unknown> => {
  if (!document.fonts?.load) return Promise.resolve()

  const loads = [...drawnFaces(root)].map(([face, text]) =>
    document.fonts.load(face, [...new Set(text)].join('')),
  )

  return Promise.race([
    Promise.allSettled(loads),
    new Promise((resolve) => setTimeout(resolve, PRINT_FONT_LIMIT)),
  ])
}
