import DOMPurify from 'dompurify'

import { getAttachmentUrl } from './mediaUploads'

const generateUniqueId = () => {
	return Math.random().toString(36).slice(2, 11)
}

const cloneObj = (obj: any) => JSON.parse(JSON.stringify(obj))

const getThumbnailCardStyles = (thumbnail: string) => ({
	backgroundImage: `url(${getAttachmentUrl(thumbnail)})`,
	backgroundSize: 'cover',
	backgroundPosition: 'center',
})

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

// runs the first call now and the latest of any that follow at the next frame.
// A hoisted declaration: element.js calls useTextEditor() while it loads, and
// this module can still be loading then (helpers -> mediaUploads -> element).
function throttleToFrame(fn: (...args: any[]) => void) {
	let frame: number | null = null
	let latest: any[] | null = null

	const flush = () => {
		frame = null
		if (latest) run(...latest)
	}

	const run = (...args: any[]) => {
		if (frame) {
			latest = args
			return
		}
		latest = null
		frame = requestAnimationFrame(flush)
		fn(...args)
	}

	return run
}

export {
	generateUniqueId,
	cloneObj,
	getThumbnailCardStyles,
	getDocFromHTML,
	hasListMarkup,
	sanitizeSlideHTML,
	isCmdOrCtrl,
	normalizeRotation,
	throttleToFrame,
}
