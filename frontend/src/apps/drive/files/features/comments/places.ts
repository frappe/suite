import type { ID } from 'yjs'

/** A thread on the whole document rather than on a part of it. */
export const DOCUMENT_ANCHOR = 'document'

/** Where a thread shows in this tab. */
export type ThreadPlace =
  | { kind: 'document' }
  | { kind: 'text'; from: number; to: number; quote: string }
  // An end's text hasn't reached this tab yet
  | { kind: 'arriving'; quote: string }
  // Every character it was made on is deleted
  | { kind: 'deleted'; quote: string }
  // An old comment moved over without its place
  | { kind: 'unplaced' }

/** Each thread's place in this tab, by thread name. */
export type ThreadPlaces = ReadonlyMap<string, ThreadPlace>

/**
 * Where an app's comments point, read from the anchor Drive keeps. An app with
 * only whole-document comments passes none.
 */
export interface CommentAnchors {
  /** The words a comment is on; empty for the whole document. */
  quote: (anchor: string) => string
  /** The Yjs items the anchor holds on to, which the server must hold before the comment posts. */
  ends: (anchor: string) => ID[]
}

/** Comments on the whole document only. */
export const WHOLE_DOCUMENT: CommentAnchors = { quote: () => '', ends: () => [] }

export type { FileNoun } from '@/platform/collab/restoreNotices'
