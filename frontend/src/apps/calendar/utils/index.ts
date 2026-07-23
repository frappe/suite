import { toast } from 'frappe-ui'

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export const raiseToast = (message: string, type = 'success') => {
	if (type === 'success') return toast.success(message)

	const div = document.createElement('div')
	div.innerHTML = message
	// strip html tags
	const text =
		div.textContent || div.innerText || __('Failed to perform action. Please try again later.')
	toast.error(text)
}

export const raisePromiseToast = (
	action: () => Promise<unknown>,
	loading: string,
	success: string,
	undoAction?: () => void,
) => {
	toast.removeAll()

	const error = __('Action failed. Please try again later.')

	if (undoAction)
		return toast.promise(action(), {
			loading,
			success,
			error,
			successAction: { label: __('Undo'), onClick: () => undoAction() },
		})

	toast.promise(action(), { loading, success, error })
}

export const isUrl = (str: string) => {
	if (typeof str !== 'string' || !str.trim()) return false
	str = str.trim()
	try {
		const url = new URL(/^https?:\/\//i.test(str) ? str : 'https://' + str)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
		const parts = url.hostname.split('.')
		return parts.length >= 2 && parts.every((p) => p.length > 0)
	} catch {
		return false
	}
}

export const getReorderedParticipants = (
	participants,
	organizerEmail,
	originalParticipants?: any[],
) => {
	const original = new Set(originalParticipants?.map((p) => p.email) || [])

	const organizer = participants.find((p) => p.email === organizerEmail)
	const rest = participants
		.filter((p) => p.email !== organizerEmail)
		.map((p) => ({ ...p, isOrganizer: false, isNew: !original.has(p.email) }))

	return organizer ? [{ ...organizer, isOrganizer: true }, ...rest] : rest
}

export const shouldIgnoreKeypress = (
	e: KeyboardEvent,
	allowCtrlAndMeta: boolean = false,
): boolean => {
	if (!allowCtrlAndMeta && (e.ctrlKey || e.metaKey)) return true

	const target = e.target as HTMLElement
	return (
		(target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') ||
		target.tagName === 'TEXTAREA' ||
		target.isContentEditable ||
		e.altKey
	)
}

// Meet links are stored as absolute URLs built from the site origin (get_url),
// which differs from the frontend origin in dev. Only the path is kept for
// navigation, so joining always stays on our own origin regardless of the
// stored host. Rejects external meeting services whose URLs contain /meet/.
export const getMeetUrl = (url?: string) => {
	if (!url) return ''
	const value = url.replace(/\W+$/, '')

	try {
		const parsed = new URL(value, window.location.origin)
		const isRelative = !value.startsWith('http')
		if (
			parsed.pathname.startsWith('/meet/') &&
			(isRelative || parsed.origin === window.location.origin)
		)
			return parsed.pathname + parsed.search + parsed.hash
	} catch {
		return ''
	}

	return ''
}
