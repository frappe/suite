import type * as Y from 'yjs'

import { drawnSlides } from '@/apps/slides/collab/drawnDeck'

import type { CompositeAnswer } from './compositeGroups'

async function savedSlidesOf(
  answer: CompositeAnswer,
  read: (node: string) => Promise<Y.Doc | null>,
) {
  if (!answer.readable || !answer.node || answer.composite) {
    return answer
  }

  try {
    const doc = await read(answer.node)
    return doc ? { ...answer, slides: drawnSlides(doc) } : answer
  } catch {
    return { ...answer, slides: null, savedStateFailed: true }
  }
}

// A converted source's rows stopped at its conversion, so its saved state replaces them
export function withSavedSlides(
  answers: CompositeAnswer[],
  read: (node: string) => Promise<Y.Doc | null>,
) {
  return Promise.all(answers.map((answer) => savedSlidesOf(answer, read)))
}
