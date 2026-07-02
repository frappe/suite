import { createResource } from 'frappe-ui'

import { raiseToast } from '@/apps/mail/utils'
import { userStore } from '@/apps/mail/stores/user'

import type { Attachment } from '@/apps/mail/types'

const store = userStore()

export const fetchAttachment = createResource({
	url: 'suite.mail.api.mail.fetch_attachment',
	makeParams: (blobID: string) => ({ account: store.accountId, blob_id: blobID }),
	onError: (error) => raiseToast(error.message, 'error'),
	cache: ['attachment'],
})

export const getAttachmentUrl = async (blobID: string, type?: string) => {
	const attachment = await fetchAttachment.submit(blobID)
	const byteArray = new Uint8Array(attachment)
	const blob = new Blob([byteArray], { type })
	return URL.createObjectURL(blob)
}

export const fetchAttachmentsAsZip = createResource({
	url: 'suite.mail.api.mail.fetch_attachments_as_zip',
	makeParams: (attachments: Attachment[]) => ({
		account: store.accountId,
		attachments: JSON.stringify(
			attachments.map((a) => ({ blob_id: a.blob_id, filename: a.filename })),
		),
	}),
	onError: (error) => raiseToast(error.message, 'error'),
})

export const getAttachmentsZipUrl = async (attachments: Attachment[]) => {
	const zip = await fetchAttachmentsAsZip.submit(attachments)
	const byteArray = new Uint8Array(zip)
	const blob = new Blob([byteArray], { type: 'application/zip' })
	return URL.createObjectURL(blob)
}
