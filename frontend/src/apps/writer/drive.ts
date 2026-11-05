/**
 * Writer's calls to the Drive and Suite routes that `DocumentSession` does not
 * cover: uploading media into a document, purging the nodes a failed import
 * uploaded, the people list the mention menu reads, and sharing the document
 * with someone a comment mentions.
 *
 * Every call goes to `/api/suite/drive/` or `/api/suite/`, never to a legacy
 * Drive method.
 */
import type { MentionSuggestionItem, UploadedMedia, UploadFunction } from 'frappe-ui/editor'
import { watch } from 'vue'

import { api, client, useUpload } from '@/api'
import { documentCredentials } from '@/apps/drive'
import { randomId } from '@/platform/random-id'

/** A person on this site, in the shape the mention menu reads. */
export interface WriterUser extends MentionSuggestionItem {
  name: string
  email: string
  full_name: string
  user_image: string | null
  value: string
  label: string
  /** Asked about a document: whether they can open it. */
  has_access?: boolean
  is_blocked?: boolean
}

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

/**
 * The route pages users and groups together, so groups are dropped. A question
 * about a document carries its share link, as the server reads a link commenter's
 * role from it.
 */
async function findPeople(input: {
  q?: string
  node?: string
  users?: string[]
}): Promise<WriterUser[]> {
  const context = input.node ? documentCredentials(input.node).context : undefined
  const page = await client.query(api.suite.people.list, input, { context })
  return page.rows.flatMap((row) =>
    row.kind === 'user'
      ? [
          {
            name: row.name,
            email: row.email,
            full_name: row.full_name ?? '',
            user_image: row.user_image,
            value: row.email,
            label: (row.full_name || row.email).trimEnd(),
            ...(row.has_access !== undefined && { has_access: row.has_access }),
            ...(row.is_blocked && { is_blocked: true }),
          },
        ]
      : [],
  )
}

/**
 * The first page of people who match `query`, from `GET /api/suite/people`,
 * which any Suite user may call. With no query it is the first page of
 * everyone. With `node`, people who can open that document come first, the
 * caller is left out, and each person says whether they can open it.
 */
export function searchUsers(query: string, node?: string | null): Promise<WriterUser[]> {
  const q = query.trim()
  return findPeople({ ...(q && { q }), ...(node && { node }) })
}

/**
 * The people among `users` who can't open `node`, as the mention menu marks
 * them. A failed lookup counts nobody, so it never stops a comment.
 */
export async function peopleWithoutAccess(
  node: string,
  users: readonly string[],
): Promise<WriterUser[]> {
  const found = await findPeople({ node, users: [...users] }).catch(() => [])
  return found.filter((person) => person.has_access === false)
}
