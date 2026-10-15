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

export function versionLabel(version: DocumentVersion) {
  return version.label || `Version ${version.seq}`
}

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

/** Adds, replies to, resolves and deletes the document's comments. */
function threadActions(session: PanelSession, refreshThreads: () => Promise<void>) {
  function change(action: () => Promise<unknown>, fallback: string) {
    return changeThreads(action, refreshThreads, fallback)
  }

  const { comments } = session
  return {
    addComment: (text: string, authorName?: string) =>
      change(() => comments.create('document', text, authorName), 'Could not add the comment.'),
    reply: (thread: string, text: string, authorName?: string) =>
      change(() => comments.reply(thread, text, authorName), 'Could not add the reply.'),
    resolve: (thread: string, isResolved: boolean) =>
      change(() => comments.resolve(thread, isResolved), 'Could not change the thread.'),
    removeComment: (comment: string) =>
      change(() => comments.remove(comment), 'Could not delete the comment.'),
  }
}

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
    ...threadActions(session, refreshThreads),
  }
}
