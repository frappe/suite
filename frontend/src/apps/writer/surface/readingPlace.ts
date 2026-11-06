/** Where someone is reading: the first block showing at the top, and how far its top is from there. */
export interface ReadingPlace {
  block: number
  offset: number
}

function blocksIn(scroller: Element) {
  return [...(scroller.querySelector('.ProseMirror')?.children ?? [])]
}

/** The place read in a scrolled editor page; null when it shows no blocks. */
export function readingPlace(scroller: Element): ReadingPlace | null {
  const top = scroller.getBoundingClientRect().top
  const blocks = blocksIn(scroller)
  const block = blocks.findIndex((element) => element.getBoundingClientRect().bottom > top)
  if (block < 0) {
    return null
  }

  return { block, offset: blocks[block].getBoundingClientRect().top - top }
}

/** Scrolls an editor page so the same block sits where it sat; the last block stands in for one past the end. */
export function goToPlace(scroller: Element | null, place: ReadingPlace | null) {
  if (!scroller || !place) {
    return
  }

  const blocks = blocksIn(scroller)
  const block = blocks[Math.min(place.block, blocks.length - 1)]
  if (!block) {
    return
  }

  const top = scroller.getBoundingClientRect().top
  scroller.scrollTop += block.getBoundingClientRect().top - top - place.offset
}
