import * as Y from 'yjs'

import { drawnSlides } from '@/apps/slides/collab/drawnDeck'
import { rowSlides } from '@/apps/slides/stores/presentation'

import type { VersionBody } from './versions'

/**
 * A version's slides as the read-only views draw them (Q7): a converted one as the live read-only view
 * draws its deck, an old row version as the refused page draws its rows.
 */
export function versionSlides(body: VersionBody): Record<string, unknown>[] {
  if ('legacySlides' in body) {
    return rowSlides(body.legacySlides)
  }

  const doc = new Y.Doc()
  Y.applyUpdate(doc, body.state)
  return drawnSlides(doc)
}
