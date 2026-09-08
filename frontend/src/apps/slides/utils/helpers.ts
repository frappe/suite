import DOMPurify from 'dompurify'

import { getAttachmentUrl } from './mediaUploads'

const generateUniqueId = () => {
	return Math.random().toString(36).slice(2, 11)
}

const setCursorPositionAtEnd = (e: Event) => {
	const selection = window.getSelection()
	if (!e.target || !selection) return

	const target = e.target as HTMLElement
	const range = document.createRange()

	range.selectNodeContents(target)
	range.collapse(false) // set cursor to end of text

	selection.removeAllRanges()
	selection.addRange(range)
}

const handleScrollBarWheelEvent = (e: WheelEvent) => {
	// allow normal scroll behaviour
	if (!isCmdOrCtrl(e)) return

	// prevent zoom event from triggering
	e.preventDefault()
	e.stopPropagation()
}

const cloneObj = (obj: any) => JSON.parse(JSON.stringify(obj))

const getThumbnailCardStyles = (
	thumbnail: string,
	sourcePresentation?: { name: string; owner: string },
) => {
	const thumbnailUrl = getAttachmentUrl(thumbnail, sourcePresentation)
	return {
		backgroundImage: `url(${thumbnailUrl})`,
		backgroundSize: 'cover',
		backgroundPosition: 'center',
	}
}

const getDocFromHTML = (html: string) => {
	const parser = new DOMParser()
	return parser.parseFromString(html, 'text/html')
}

const hasListMarkup = (html: string) => !!html && /<(ul|ol|li)[\s>]/i.test(html)

const sanitizeSlideHTML = (html: string) => {
	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS: [
			'p',
			'span',
			'strong',
			'b',
			'em',
			'i',
			'u',
			's',
			'ul',
			'ol',
			'li',
			'br',
			'table',
			'colgroup',
			'col',
			'thead',
			'tbody',
			'tr',
			'th',
			'td',
		],
		ALLOWED_ATTR: ['style', 'class', 'colspan', 'rowspan', 'colwidth'],
	})
}

const isCmdOrCtrl = (e: KeyboardEvent | MouseEvent) => {
	return e.metaKey || e.ctrlKey
}

const normalizeRotation = (deg: number) => ((deg % 360) + 360) % 360

export {
	generateUniqueId,
	setCursorPositionAtEnd,
	handleScrollBarWheelEvent,
	cloneObj,
	getThumbnailCardStyles,
	getDocFromHTML,
	hasListMarkup,
	sanitizeSlideHTML,
	isCmdOrCtrl,
	normalizeRotation,
}
