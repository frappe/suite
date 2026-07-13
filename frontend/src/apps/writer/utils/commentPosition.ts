export type CommentTop = number | null | undefined

export const isCommentPositioned = (top: CommentTop): top is number =>
	top !== null && top !== undefined

export const getCommentAnchorTop = (elementTop: number, containerTop: number) =>
  elementTop - containerTop

export const stackCommentTop = (
  anchorTop: CommentTop,
  lastBottom: number,
): number | null =>
  isCommentPositioned(anchorTop) ? Math.max(anchorTop, lastBottom) : null
