import { stampLabel } from './versions'

/** One comment of a thread as `GET nodes/<id>/threads` publishes it. */
export interface ThreadComment {
  name: string
  content: string
  author: string | null
  author_name: string | null
  /** The signed-in author as Drive names them. Absent for a guest. */
  person?: { full_name: string; user_image: string | null } | null
  creation: string | null
}

/** `GET nodes/<id>/threads` */
export interface CommentThread {
  name: string
  resolved: boolean
  comments: ThreadComment[]
}

/** A signed-in author by the name Drive sends; a guest is labelled by `DriveCommentAuthor`. */
export function authorLabel(comment: ThreadComment): string {
  return comment.person?.full_name || comment.author || 'Someone'
}

/** When the comment was posted, as a short local label. */
export function commentTime(comment: ThreadComment): string {
  return stampLabel(comment.creation)
}
