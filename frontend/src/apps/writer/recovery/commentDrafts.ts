/**
 * Comments written on a document's text and not yet taken by Drive, kept per
 * person and document until Drive takes them or their author discards them. A
 * box being typed in belongs to its tab and outlives a reload of it; once sent,
 * its words are kept on this device for every tab. Blocked storage keeps
 * nothing and never throws.
 */
export interface CommentDraft {
  // Made here and sent with every try, so a resend never posts twice
  clientId: string
  anchor: string
  text: string
  // Comment was pressed, so the words stay as sent and any later send is a retry
  isSent: boolean
}

const PREFIX = 'suite:writer-comment-drafts:'

/** This person's drafts of one document: the device's sent ones, then this tab's unsent ones. */
export function readDrafts(user: string, node: string): CommentDraft[] {
  const key = keyOf(user, node)
  const sent = readKept(true, key) ?? []
  // A draft caught in both stores while being sent shows once, as sent
  const unsent = (readKept(false, key) ?? []).filter(
    (draft) => !sent.some((other) => other.clientId === draft.clientId),
  )
  return [...sent, ...unsent]
}

/** True when the device holds the draft no longer; false when its storage can't be read. */
export function isDiscarded(user: string, node: string, clientId: string) {
  const key = keyOf(user, node)
  const [sent, unsent] = [readKept(true, key), readKept(false, key)]
  if (!sent || !unsent) {
    return false
  }

  return ![...sent, ...unsent].some((draft) => draft.clientId === clientId)
}

// The drafts in one store; null when it can't be read
function readKept(isSent: boolean, key: string) {
  try {
    return parseDrafts(storeFor(isSent).getItem(key))
  } catch {
    return null
  }
}

/** The client ids of the drafts another tab took out of this person's drafts for the document. */
export function removedElsewhere(user: string, node: string, event: StorageEvent) {
  if (event.key !== keyOf(user, node)) {
    return new Set<string>()
  }

  const left = new Set(parseDrafts(event.newValue).map((draft) => draft.clientId))
  const before = parseDrafts(event.oldValue).map((draft) => draft.clientId)
  return new Set(before.filter((clientId) => !left.has(clientId)))
}

function parseDrafts(value: string | null): CommentDraft[] {
  let stored: unknown
  try {
    stored = JSON.parse(value ?? '[]')
  } catch {
    return []
  }

  if (!Array.isArray(stored)) {
    return []
  }

  return stored.filter(isDraft).map((draft) => ({ ...draft, isSent: draft.isSent === true }))
}

/** Keeps the draft, in place of any earlier one with its client id: unsent in this tab, sent on the device. */
export function keepDraft(user: string, node: string, draft: CommentDraft) {
  const key = keyOf(user, node)
  // The old copy goes only once the new one is written, so no crash loses the words
  if (replaceIn(draft.isSent, key, draft)) {
    removeFrom(!draft.isSent, key, draft.clientId)
  }
}

export function dropDraft(user: string, node: string, clientId: string) {
  const key = keyOf(user, node)
  removeFrom(true, key, clientId)
  removeFrom(false, key, clientId)
}

function replaceIn(isSent: boolean, key: string, draft: CommentDraft) {
  const kept = readKept(isSent, key) ?? []
  const others = kept.filter((other) => other.clientId !== draft.clientId)
  return writeDrafts(isSent, key, [...others, draft])
}

function removeFrom(isSent: boolean, key: string, clientId: string) {
  const left = (readKept(isSent, key) ?? []).filter((draft) => draft.clientId !== clientId)
  writeDrafts(isSent, key, left)
}

function writeDrafts(isSent: boolean, key: string, drafts: CommentDraft[]) {
  try {
    if (drafts.length) {
      storeFor(isSent).setItem(key, JSON.stringify(drafts))
    } else {
      storeFor(isSent).removeItem(key)
    }

    return true
  } catch {
    // Blocked or full storage: the draft lives only in this tab
    return false
  }
}

function storeFor(isSent: boolean) {
  return isSent ? localStorage : sessionStorage
}

function keyOf(user: string, node: string) {
  return `${PREFIX}${user}:${node}`
}

function isDraft(value: unknown): value is CommentDraft {
  const draft = value as Partial<CommentDraft> | null
  return (
    typeof draft?.clientId === 'string' &&
    typeof draft.anchor === 'string' &&
    typeof draft.text === 'string'
  )
}
