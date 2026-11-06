import { api, client } from '@/api'
import type { DownloadGetOutput } from '@/apps/drive/client/generated'
import { nodeContentUrl } from '@/apps/drive/client/nodes'
import type { DriveNode } from '@/apps/drive/client/types'
import { toast, type ToastId } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

import { subject } from './changeToast'

export type DriveDownload = DownloadGetOutput

export const DOWNLOAD_POLL_MS = 2000

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
    if (asked.status === 'Preparing') {
      // Keyed by the download, so asking again for the same selection updates
      // this toast instead of adding one. The settled states set their own
      // duration, because an update keeps the one it had.
      waiting = asked.name
      toast.loading(__('Preparing {0} for download', [name]), {
        id: waiting,
        description:
          asked.delivery === 'Inbox'
            ? __(
                'The download starts here when the zip is ready. A notification will bring it too.',
              )
            : __('The download starts here when the zip is ready.'),
        duration: Infinity,
      })
    }
    const settled = await settledDownload(asked)
    if (settled.url) {
      window.location.assign(settled.url)
      if (waiting !== undefined) settle('success', __('Downloading {0}', [name]))
    } else settle('error', __('Could not download {0}', [name]), settled.error ?? undefined)
  } catch (error) {
    const reason = error instanceof Error ? error.message : undefined
    settle('error', __('Could not download {0}', [name]), reason)
  }
}

/**
 * Waits for a Page download, one whose access comes through a share link,
 * until its zip is ready or has failed. No notification brings it, so the
 * page that asked polls for it (Drive spec §11.2).
 */
export async function settledDownload(download: DriveDownload): Promise<DriveDownload> {
  let current = download
  while (current.status === 'Preparing') {
    await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_POLL_MS))
    current = await client.query(api.drive.downloads.get, { download: current.name })
  }
  return current
}
