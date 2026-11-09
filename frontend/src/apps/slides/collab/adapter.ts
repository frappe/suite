// What Slides tells the content layer's client (platform/collab) about its decks
// Nothing here draws a peer or sends a readable copy yet: those come with live editing

import type { CollabAdapter } from '@/platform/collab'

import declared from '../../../../../suite/slides/content/schema.json'

export const slidesAdapter: CollabAdapter = {
  app: 'slides',
  schemaVersion: declared.schema,
  toPeerPosition: () => null,
}
