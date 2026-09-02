import { Check, Minus, X } from 'lucide-vue-next'
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
	toast.dismiss()

	const error = __('Action failed. Please try again later.')

	if (undoAction)
		return toast.promise(action(), {
			loading,
			// The button rides on the success slot itself. `successAction` was a frappe-ui 0.1.x
			// extension to toast.promise, dropped in v1 — sonner has no such key, so it went
			// nowhere and the toast came up without its Undo.
			success: {
				message: success,
				action: { label: __('Undo'), onClick: () => undoAction() },
			},
			error,
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

/**
 * How a participation status is drawn, wherever it is shown.
 *
 * The participant list draws it as a badge and needs a component and its colours; the dialog
 * that asks how far an answer reaches draws it as the dialog's own icon and needs a
 * `lucide-*` name and a theme. Both read the same three answers from here, so a yes cannot
 * come out green in one place and red in the other.
 *
 * Anything that is not an answer — NEEDS-ACTION, or nothing at all — falls through to the
 * declined shape; the callers only draw this once there is an answer to draw.
 */
export const participationStatusDisplay = (status?: string) => {
	if (status === 'ACCEPTED')
		return {
			icon: Check,
			name: 'lucide-check',
			theme: 'green' as const,
			class: 'bg-surface-green-1 text-ink-green-6',
		}
	if (status === 'TENTATIVE')
		return {
			icon: Minus,
			name: 'lucide-minus',
			// No gray in the dialog's themes; without one it draws the neutral surface, which is
			// the gray this badge already uses.
			theme: undefined,
			class: 'bg-surface-gray-1 text-ink-gray-6',
		}
	return {
		icon: X,
		name: 'lucide-x',
		theme: 'red' as const,
		class: 'bg-surface-red-1 text-ink-red-6',
	}
}
