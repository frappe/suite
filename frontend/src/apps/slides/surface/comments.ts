import type { DocumentThread } from '@/apps/drive'

import { stampLabel } from './versions'

type ThreadComment = DocumentThread['comments'][number]

/** A signed-in author by the name Drive sends; a guest is labelled by `DriveCommentAuthor`. */
export function authorLabel(comment: ThreadComment): string {
  return comment.person?.full_name || comment.author
}

/** When the comment was posted, as a short local label. */
export function commentTime(comment: ThreadComment): string {
  return stampLabel(comment.creation)
}
