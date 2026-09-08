import { createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { userStore } from '@/apps/mail/stores/user'

import type { Attachment } from '@/apps/mail/types'

const store = userStore()

// Attachments belong to a specific account's blob store: callers inside a pane pass
// the pane's owning account (a cross-account thread in All Inboxes); everything else
// falls back to the active account.
export const fetchAttachment = createResource({
	url: 'suite.mail.api.mail.fetch_attachment',
	makeParams: ({ blobID, account }: { blobID: string; account?: string }) => ({
		account: account || store.accountId,
		blob_id: blobID,
	}),
	onError: (error) => raiseToast(error.message, 'error'),
	cache: ['attachment'],
})

export const getAttachmentUrl = async (blobID: string, type?: string, account?: string) => {
	const attachment = await fetchAttachment.submit({ blobID, account })
	const byteArray = new Uint8Array(attachment)
	const blob = new Blob([byteArray], { type })
	return URL.createObjectURL(blob)
}

const fetchAttachmentsAsZip = createResource({
	url: 'suite.mail.api.mail.fetch_attachments_as_zip',
	makeParams: ({ attachments, account }: { attachments: Attachment[]; account?: string }) => ({
		account: account || store.accountId,
		attachments: JSON.stringify(
			attachments.map((a) => ({ blob_id: a.blob_id, filename: a.filename })),
		),
	}),
	onError: (error) => raiseToast(error.message, 'error'),
})

export const getAttachmentsZipUrl = async (attachments: Attachment[], account?: string) => {
	const zip = await fetchAttachmentsAsZip.submit({ attachments, account })
	const byteArray = new Uint8Array(zip)
	const blob = new Blob([byteArray], { type: 'application/zip' })
	return URL.createObjectURL(blob)
}
