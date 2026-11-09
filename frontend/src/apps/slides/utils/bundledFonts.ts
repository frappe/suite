// Inter is in the app bundle, these aren't
const bundledFontFaces = [
  '400 16px Anton',
  '400 16px "Courier Prime"',
  'italic 400 16px "Courier Prime"',
  '700 16px "Courier Prime"',
  'italic 700 16px "Courier Prime"',
]

// one char per unicode-range subset
const subsetSample = 'AĀẠ'

export const loadBundledFonts = (): Promise<unknown> => {
  if (!document.fonts?.load) return Promise.resolve()
  return Promise.all(bundledFontFaces.map((face) => document.fonts.load(face, subsetSample)))
}

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
