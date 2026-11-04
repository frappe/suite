import { api, client } from '@/api'
import type { DownloadGetOutput } from '@/apps/drive/client/generated'

export type DriveDownload = DownloadGetOutput

export const DOWNLOAD_POLL_MS = 2000

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
