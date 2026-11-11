/**
 * Writer's calls to the Drive and Suite routes that `DocumentSession` does not
 * cover: uploading media into a document and purging the nodes a failed import
 * uploaded.
 *
 * Every call goes to `/api/suite/drive/` or `/api/suite/`, never to a legacy
 * Drive method.
 */
import type { UploadedMedia, UploadFunction } from 'frappe-ui/editor'
import { watch } from 'vue'

import { api, client, useUpload } from '@/api'
import { randomId } from '@/platform/random-id'

/** The URL a Writer body stores for a media node. `suite/writer/drive.py` reads it back. */
export function embedUrl(node: string): string {
  return `/api/method/suite.writer.api.embed.get?id=${encodeURIComponent(node)}`
}

/**
 * Upload a picture or video into `document`, for the editor's upload function.
 *
 * It uses Drive's resumable transfer, which sends the file in chunks. One
 * request is capped at 25 MB, so a single-request upload refuses most videos.
 * The random part of the title keeps two files with the same name apart.
 */
export async function uploadMedia(
  document: string,
  file: File,
  { signal, onProgress }: Parameters<UploadFunction>[1] = {},
): Promise<UploadedMedia> {
  const upload = useUpload(api.drive.uploads.transfer, { silent: true })
  const cancel = () => upload.cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  const stopProgress = watch(
    () => upload.progress,
    (percent) => {
      if (percent === null) return
      onProgress?.({ loaded: (file.size * percent) / 100, total: file.size, percent })
    },
  )
  try {
    const node = await upload.run({
      parent_node: document,
      file,
      filename: `${document} embed ${randomId().slice(0, 8)} -${file.name}`,
    })
    return { file_url: embedUrl(node.name) }
  } finally {
    stopProgress()
    signal?.removeEventListener('abort', cancel)
  }
}

/**
 * Delete nodes forever. Used to roll back the pictures a failed import uploaded.
 *
 * Drive purges only a trash root (§8.8), so the nodes go to the trash first.
 * Trashing needs EDIT and purging needs MANAGE: a node the caller may trash
 * but not purge stays in the trash and expires with it. Both batches report a
 * refused node in `failed` instead of throwing, so one refusal stops nothing.
 */
export async function purgeNodes(nodes: readonly string[]): Promise<void> {
  if (!nodes.length) return
  const trashed = await client.mutation(api.drive.nodes.batch, {
    nodes: [...nodes],
    patch: { state: 'Trashed' },
  })
  if (trashed.ok.length) await client.mutation(api.drive.nodes.purgeBatch, { nodes: trashed.ok })
}
