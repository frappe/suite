import { api, client } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import type { Attachment } from '@/apps/mail/types'
import { raiseError } from '@/apps/mail/utils'

/** Creates a preview URL for the blob in the message's owning account. */
export async function getAttachmentUrl(
  blobID: string,
  type?: string,
  account?: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const bytes = await client.query(
      api.mail.attachments.download,
      { account: account || userStore().accountId, blob_id: blobID },
      { signal },
    )
    signal?.throwIfAborted()
    return URL.createObjectURL(type ? new Blob([bytes], { type }) : bytes)
  } catch (cause) {
    failedDownload(cause)
  }
}

/** Creates a ZIP URL; the caller owns its download and eventual revocation. */
export async function getAttachmentsZipUrl(
  attachments: Attachment[],
  account?: string,
): Promise<string> {
  try {
    const bytes = await client.query(api.mail.attachments.zip, {
      account: account || userStore().accountId,
      attachments: attachments.map((attachment) => ({
        blob_id: attachment.blob_id,
        filename: attachment.filename,
      })),
    })
    return URL.createObjectURL(bytes)
  } catch (cause) {
    failedDownload(cause)
  }
}

function failedDownload(cause: unknown): never {
  if (!(cause instanceof Error && cause.name === 'AbortError')) raiseError(cause)
  throw cause
}
