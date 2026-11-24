// A presentation read back as the old JSON the converter takes (conversion.ts `LegacyDeck`), for an agent:
// slides in their order, each element in its old form with its text as HTML, as the slide store draws it

import type { Doc } from 'yjs'

import { DRAWN_BLANK } from './deck'
import { drawnSlides } from './drawnDeck'

export function deckJson(doc: Doc) {
  // The drawn blank is not in the doc, so a presentation with no slides answers none
  const slides = drawnSlides(doc).filter(({ clientId }) => clientId !== DRAWN_BLANK)
  return { slides: slides.map(({ clientId, idx: _idx, ...slide }) => ({ id: clientId, ...slide })) }
}
