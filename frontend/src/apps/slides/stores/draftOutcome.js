// a newer document may only be a stored copy, so only the server can rule on this draft
export function needsServerCheck(local, servedModified, hasLanded) {
  return (
    local?.dirty &&
    !hasLanded &&
    local.baseModified &&
    local.baseModified !== servedModified &&
    !(local.baseModified > servedModified)
  )
}

// keep: stays on its own base; restore: built on what was served; discard: the server copy wins
export function draftOutcome(local, servedModified, hasLanded, hasServerAnswered) {
  if (local?.retired) {
    return 'discard'
  }

  // the worker may replay a document older than the last save; the copy that
  // save left behind is then the truth, and unsynced edits ride along in it
  const isServedStale = local?.baseModified > servedModified
  const isUnruled = needsServerCheck(local, servedModified, hasLanded) && !hasServerAnswered
  if (isServedStale || isUnruled) {
    return 'keep'
  }

  if (local?.dirty && local.baseModified === servedModified) {
    return 'restore'
  }

  return 'discard'
}
