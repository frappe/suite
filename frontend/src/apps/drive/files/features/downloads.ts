import { api, client } from '@/api'
import type { DownloadGetOutput } from '@/apps/drive/client/generated'
import { nodeContentUrl } from '@/apps/drive/client/nodes'
import type { DriveNode } from '@/apps/drive/client/types'
import { toast, type ToastId } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

import { formatBytes } from '../internal/format'
import { MAX_BATCH_NODES } from './batches'
import { subject } from './changeToast'
import { isTransient, online, pause } from './network'

export type DriveDownload = DownloadGetOutput

export const DOWNLOAD_POLL_MS = 2000
/** After the first minute a zip is large, so polls slow down. */
const SLOW_POLL_MS = 5000
const SLOW_AFTER_MS = 60_000
/** The server's `STALLED_AFTER` (`suite/drive/_core/downloads.py`): it gives up on a zip then. */
const GIVE_UP_AFTER_MS = 75 * 60_000
const BACKOFF_MS = [2000, 4000, 8000, 15_000]

export interface SettleOptions {
  /** `false` while a poll cannot reach the server, `true` when one gets through again. */
  onConnection?: (connected: boolean) => void
  now?: () => number
}

/** A folder or a link downloads in a zip; anything else downloads its own bytes. */
const ZIPPED_KINDS = new Set(['folder', 'link'])
/** How long a settled download's toast stays, once it stops waiting. */
const SETTLED_DOWNLOAD_TOAST_MS = 5000

/**
 * One file downloads at once. Anything else becomes one zip that Drive builds
 * in the background (Drive spec §11.2). A toast stays on the page until the
 * zip is ready, then the download starts here. An Inbox zip is also linked
 * from a notification, for whoever left the page meanwhile.
 */
export async function downloadItems(
  rows: readonly Pick<DriveNode, 'name' | 'title' | 'kind'>[],
): Promise<void> {
  const [only] = rows
  if (rows.length === 1 && only && !ZIPPED_KINDS.has(only.kind)) {
    window.location.assign(nodeContentUrl(only.name, { download: true }))
    return
  }
  // One zip is one request, and the server takes at most this many nodes in one.
  if (rows.length > MAX_BATCH_NODES) {
    toast.error(__('Download up to {0} items at a time.', [MAX_BATCH_NODES]))
    return
  }
  const name = subject(rows.map((row) => ({ node: row.name, title: row.title })))
  let waiting: ToastId | undefined
  // Settles the waiting toast in place, or shows a fresh one when none was waiting.
  const settle = (kind: 'success' | 'error', message: string, description?: string) =>
    toast[kind](
      message,
      waiting === undefined
        ? { description }
        : { id: waiting, description, duration: SETTLED_DOWNLOAD_TOAST_MS },
    )
  try {
    // Silent: the toast below reports a refusal, naming what was asked for.
    const asked = await client.mutation(
      api.drive.downloads.start,
      { nodes: rows.map((row) => row.name) },
      { silent: true },
    )
    const description =
      asked.delivery === 'Inbox'
        ? __('The download starts here when the zip is ready. You will also get a notification.')
        : __('The download starts here when the zip is ready.')
    // Keyed by the download, so asking again for the same selection updates
    // this toast instead of adding one. It sets no `duration`: vue-sonner reads
    // it once, when a toast mounts, so an infinite one would never close; a
    // loading toast stays without it.
    const showWaiting = (text: string) =>
      toast.loading(__('Preparing {0} for download', [name]), {
        id: asked.name,
        description: text,
      })
    if (asked.status === 'Preparing') {
      waiting = asked.name
      showWaiting(description)
    }
    const settled = await settledDownload(asked, {
      onConnection: (connected) =>
        showWaiting(connected ? description : __('Waiting for connection…')),
    })
    if (settled.url) {
      window.location.assign(settled.url)
      void markDownloadDelivered(settled)
      const size = settled.size !== null ? formatBytes(settled.size) : undefined
      if (waiting !== undefined) settle('success', __('Downloading {0}', [name]), size)
    } else settle('error', __('Could not download {0}', [name]), settled.error ?? undefined)
  } catch (error) {
    const reason = error instanceof Error ? error.message : undefined
    settle('error', __('Could not download {0}', [name]), reason)
  }
}

/**
 * Waits for a Page download, one whose access comes through a share link,
 * until its zip is ready or has failed. No notification brings it, so the
 * page that asked polls for it (Drive spec §11.2). A dropped connection waits
 * and polls again, polls slow down after a minute, sign out stops the wait,
 * and the wait ends when the server gives up.
 */
export async function settledDownload(
  download: DriveDownload,
  options: SettleOptions = {},
): Promise<DriveDownload> {
  const stop = new AbortController()
  const forget = useSession().onLogout(() => stop.abort())
  try {
    return await pollPatiently(download, stop.signal, options)
  } finally {
    forget()
  }
}

async function pollPatiently(
  download: DriveDownload,
  signal: AbortSignal,
  { onConnection, now = Date.now }: SettleOptions,
): Promise<DriveDownload> {
  const started = now()
  let current = download
  let failures = 0
  let connected = true
  const setConnected = (value: boolean) => {
    if (value !== connected) onConnection?.(value)
    connected = value
  }
  while (current.status === 'Preparing') {
    const waited = now() - started
    if (waited >= GIVE_UP_AFTER_MS)
      return { ...current, status: 'Failed', error: __('The zip took too long. Try again.') }
    const delay = failures
      ? BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]!
      : waited < SLOW_AFTER_MS
        ? DOWNLOAD_POLL_MS
        : SLOW_POLL_MS
    await pause(delay, signal)
    if (!navigator.onLine) {
      setConnected(false)
      await online(signal)
    }
    try {
      current = await client.query(api.drive.downloads.get, { download: current.name }, { signal })
      setConnected(true)
      failures = 0
    } catch (cause) {
      if (signal.aborted || !isTransient(cause)) throw cause
      setConnected(false)
      failures += 1
    }
  }
  return current
}

/**
 * The server notifies the bell when an Inbox zip is ready, also when this tab
 * delivered it. That notification is marked read here, so the bell counts only downloads nobody has started. It stays in the
 * bell, as the download's link until it expires.
 */
export async function markDownloadDelivered(download: DriveDownload): Promise<void> {
  if (download.delivery !== 'Inbox') return
  try {
    const unread = await client.query(api.drive.notifications.list, { unread: true, limit: 60 })
    const row = unread.rows.find(
      (notification) => 'download' in notification && notification.download.name === download.name,
    )
    if (!row) return
    await client.mutation(
      api.drive.notifications.markRead,
      { notifications: [row.name] },
      { silent: true },
    )
  } catch {
    // The bell keeps an unread row; the download itself has started.
  }
}
