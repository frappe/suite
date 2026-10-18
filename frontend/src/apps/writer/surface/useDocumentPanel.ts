import { toast } from 'frappe-ui'
import { reactive } from 'vue'

import type { DocumentPanel, DocumentSession, DocumentVersion } from '@/apps/drive'

type PanelSession = Pick<DocumentSession, 'comments' | 'versions'>

interface PanelLists {
  versions: DocumentVersion[]
  versionsCursor: string | null
  isLoading: boolean
  isLoadingMore: boolean
}

type VersionChanges = Parameters<PanelSession['versions']['update']>[1]

export function showError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    toast.error(error.message)
    return
  }

  toast.error(fallback)
}

async function loadVersions(session: PanelSession, lists: PanelLists) {
  lists.isLoading = true
  try {
    const page = await session.versions.list()
    lists.versions = page.rows
    lists.versionsCursor = page.next_cursor
  } catch (error) {
    showError(error, 'Could not load this panel.')
  } finally {
    lists.isLoading = false
  }
}

async function loadMoreVersions(session: PanelSession, lists: PanelLists) {
  if (!lists.versionsCursor) {
    return
  }

  lists.isLoadingMore = true
  try {
    const page = await session.versions.list(lists.versionsCursor)
    lists.versions = [...lists.versions, ...page.rows]
    lists.versionsCursor = page.next_cursor
  } catch (error) {
    // A failed next page keeps the rows already shown
    showError(error, 'Could not load more versions.')
  } finally {
    lists.isLoadingMore = false
  }
}

// Whether the change went in; the threads are read again after it does
async function changeThreads(
  change: () => Promise<unknown>,
  refreshThreads: () => Promise<void>,
  fallback: string,
) {
  try {
    await change()
  } catch (error) {
    showError(error, fallback)
    return false
  }

  await refreshThreads()
  return true
}

/** Replies to, resolves, edits and deletes the document's comments. */
function threadActions(session: PanelSession, refreshThreads: () => Promise<void>) {
  function change(action: () => Promise<unknown>, fallback: string) {
    return changeThreads(action, refreshThreads, fallback)
  }

  const { comments } = session
  return {
    reply: (thread: string, text: string, authorName: string | undefined, clientId: string) =>
      change(() => comments.reply(thread, text, authorName, clientId), 'Could not add the reply.'),
    resolve: (thread: string, isResolved: boolean) =>
      change(() => comments.resolve(thread, isResolved), 'Could not change the thread.'),
    editComment: (comment: string, text: string) =>
      change(() => comments.edit(comment, text), 'Could not save the comment.'),
    removeComment: (comment: string) =>
      change(() => comments.remove(comment), 'Could not delete the comment.'),
  }
}

export type ThreadActions = ReturnType<typeof threadActions>

// Whether the version was taken; `saveFirst` saves the tab's edits and throws why it couldn't
async function saveVersion(
  session: PanelSession,
  lists: PanelLists,
  label: string,
  saveFirst: () => Promise<void>,
) {
  try {
    await saveFirst()
    await session.versions.create('named', label)
  } catch (error) {
    showError(error, 'Could not save a version.')
    return false
  }

  toast.success('Version saved')
  await loadVersions(session, lists)
  return true
}

// Naming an automatic version also keeps it, as the daily thinner deletes only unpinned automatic ones
function renameChanges(version: DocumentVersion, label: string): VersionChanges {
  if (version.kind === 'auto') {
    return { label, pinned: true }
  }

  return { label }
}

// The renamed version, or null when Drive refused the name
async function renameVersion(
  session: PanelSession,
  lists: PanelLists,
  version: DocumentVersion,
  label: string,
) {
  const changes = renameChanges(version, label)
  try {
    await session.versions.update(String(version.seq), changes)
  } catch (error) {
    // The daily thinner can remove an automatic version while its name box is open
    if ((error as { type?: unknown } | null)?.type === 'DriveNotFound') {
      toast.error('This version no longer exists.')
      await loadVersions(session, lists)
      return null
    }

    showError(error, 'Could not rename the version.')
    return null
  }

  const renamed = { ...version, label, pinned: Number(changes.pinned ?? version.pinned) }
  lists.versions = lists.versions.map((row) => (row.seq === version.seq ? renamed : row))
  return renamed
}

// The side panel's comments and versions; comments are the document's threads, read again when the panel opens
export function useDocumentPanel(session: PanelSession, refreshThreads: () => Promise<void>) {
  const lists = reactive<PanelLists>({
    versions: [],
    versionsCursor: null,
    isLoading: false,
    isLoadingMore: false,
  })
  async function load(kind: DocumentPanel) {
    if (kind === 'comments') {
      await refreshThreads()
      return
    }

    await loadVersions(session, lists)
  }

  return {
    lists,
    load,
    loadMoreVersions: () => loadMoreVersions(session, lists),
    saveVersion: (label: string, saveFirst: () => Promise<void>) =>
      saveVersion(session, lists, label, saveFirst),
    renameVersion: (version: DocumentVersion, label: string) =>
      renameVersion(session, lists, version, label),
    ...threadActions(session, refreshThreads),
  }
}
