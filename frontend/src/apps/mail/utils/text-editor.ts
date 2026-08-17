import { Node } from '@tiptap/core'
import { useFileUpload } from 'frappe-ui'
import { ImageExtension } from 'frappe-ui/experimental'

import { randomString } from '@/apps/mail/utils'

export const CustomParagraphExtension = Node.create({
	name: 'paragraph',
	priority: 1000,
	group: 'block',
	content: 'inline*',
	parseHTML: () => [{ tag: 'div' }, { tag: 'p' }],
	renderHTML: ({ HTMLAttributes }) => ['div', HTMLAttributes, 0],
})

export const uploadFunction = async (file: File) =>
	useFileUpload().upload(file, {
		private: true,
		folder: 'Home/Frappe Mail',
		upload_endpoint: '/api/method/suite.mail.api.mail.upload_file',
	})

/**
 * Images carry a `data-cid` so the send path can turn them into inline attachments — stamped here,
 * on the way into the document, for any image that came from our own uploads.
 */
export const CustomImageExtension = ImageExtension.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			'data-cid': {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute('data-cid'),
				renderHTML: (attributes: Record<string, string>) => {
					const src = attributes.src || ''
					if (
						!attributes['data-cid'] &&
						(src.startsWith('/files') || src.startsWith('/private/files'))
					)
						attributes['data-cid'] = randomString(10)
					return { 'data-cid': attributes['data-cid'] }
				},
			},
		}
	},
}).configure({
	HTMLAttributes: { width: '600', style: 'max-width:100%; height:auto' },
	uploadFunction,
})
