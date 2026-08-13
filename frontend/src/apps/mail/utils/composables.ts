import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createResource, toast } from 'frappe-ui'

import { matchesScreenedValue, raiseOptimisticToast, raiseToast } from '@/apps/mail/utils'
import router from '@/apps/mail/router'
import { userStore } from '@/apps/mail/stores/user'

import type { COLOR_SCHEME, ComposeMailData, Identity, ScreenedAddress } from '@/apps/mail/types'

// Decided once, at load, and deliberately not reactive to resize. Mobile and desktop are
// separate component trees here, not one tree restyled: crossing 640px mid-session swaps
// them and unmounts whatever they were holding — a half-written mail vanished this way
// (#38), and every other open surface has the same exposure. A resized window therefore
// keeps the layout it started with until the page is reloaded.
//
// Which is why this is for STRUCTURE — which tree to mount, which route to take — and not
// for sizing. Tailwind's `max-sm:` keys on the same 640px but follows the viewport live, so
// a component that sizes itself from this ref ends up disagreeing with the one next to it
// after a resize. The mobile steps live in src/index.css.
const isMobile = ref(window.innerWidth < 640)

export const useScreenSize = () => ({ isMobile })

/**
 * Split View: the reading pane sits beside the list rather than over it. One user setting, read the
 * same way by every list view and by ThreadPane itself — the two halves of the split are sized from
 * it, so they must never be able to disagree about it.
 */
export const useReadingPane = () => {
	const { userResource } = userStore()
	return computed(() => !!userResource.data?.show_reading_pane)
}

/**
 * Flipping Split View from the list toolbar. Appearance settings writes the same field behind a
 * Save button; this one is a layout switch, so it applies on click — the local value flips first
 * and the whole split re-lays out from it, then rolls back if the write doesn't land.
 */
export const useToggleReadingPane = () => {
	const { userResource } = userStore()

	const setReadingPane = createResource({
		url: 'frappe.client.set_value',
		makeParams: ({ value }: { value: 0 | 1 }) => ({
			doctype: 'User Settings',
			name: userResource.data?.user_settings,
			fieldname: 'show_reading_pane',
			value,
		}),
	})

	return () => {
		const user = userResource.data
		if (!user?.user_settings) return

		const next = user.show_reading_pane ? 0 : 1
		user.show_reading_pane = next
		setReadingPane.submit(
			{ value: next },
			{
				onError: () => {
					user.show_reading_pane = next ? 0 : 1
					raiseToast(__('Unable to update Split View.'), 'error')
				},
			},
		)
	}
}

/**
 * Switching accounts stays in place wherever the view allows it — shared by the
 * sidebar's account submenu and the mobile profile sheet. Account-scoped routes
 * swap the accountId param in their own URL. The account-agnostic All Inboxes
 * routes just re-resolve the active account (bouncing to the new account's inbox
 * threw the reader out of the merged list, which spans every account anyway).
 * Everything else goes through the account shortcut, which the guard resolves to
 * the new account's default mailbox.
 */
export const useAccountSwitch = () => {
	const route = useRoute()
	const router = useRouter()
	const store = userStore()

	const switchAccount = (accountId: string) => {
		if (accountId === store.accountId) return
		if ((route.name as string)?.startsWith('mail-all-inboxes'))
			return store.resolveAccount(store.userResource.data?.accounts, accountId)
		router.push(
			route.params.accountId
				? { name: route.name!, params: { ...route.params, accountId } }
				: { name: 'mail-account-shortcut', params: { accountId } },
		)
	}

	return { switchAccount }
}

const isSidebarOpen = ref(false)

export const useSidebar = () => {
	const openSidebar = () => (isSidebarOpen.value = true)
	const closeSidebar = () => (isSidebarOpen.value = false)

	return { isSidebarOpen, openSidebar, closeSidebar }
}

// Horizontal swipe-to-page detection, shared by the mailbox thread pane and the screener
// preview: left → onSwipe(1) (next), right → onSwipe(-1). Judged on touchend (passive) so
// vertical scrolling is never delayed; a swipe must be decisively horizontal — at least
// 64px long and twice its vertical drift. Swipes over an email body never reach the pane:
// EmailContent detects them inside its iframe and re-broadcasts them as `email-swipe`
// window events, which this subscribes to as well. The time guard dedupes those (every
// mounted EmailContent re-dispatches the same message) and paces direct swipes alike.
const SWIPE_MIN_X = 64

export const useSwipeNav = (enabled: () => boolean, onSwipe: (offset: 1 | -1) => void) => {
	let origin: { x: number; y: number } | null = null
	let lastSwipeAt = 0

	const swipe = (offset: 1 | -1) => {
		if (!enabled()) return
		const now = Date.now()
		if (now - lastSwipeAt < 250) return
		lastSwipeAt = now
		onSwipe(offset)
	}

	const onTouchStart = (e: TouchEvent) => {
		origin =
			enabled() && e.touches.length === 1
				? { x: e.touches[0].clientX, y: e.touches[0].clientY }
				: null
	}

	const onTouchEnd = (e: TouchEvent) => {
		if (!origin) return
		const dx = e.changedTouches[0].clientX - origin.x
		const dy = e.changedTouches[0].clientY - origin.y
		origin = null
		if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) < Math.abs(dy) * 2) return
		swipe(dx < 0 ? 1 : -1)
	}

	const onEmailSwipe = (e: Event) => swipe((e as CustomEvent).detail === 'left' ? 1 : -1)

	onMounted(() => window.addEventListener('email-swipe', onEmailSwipe))
	onUnmounted(() => window.removeEventListener('email-swipe', onEmailSwipe))

	return { onTouchStart, onTouchEnd }
}

// Mobile folder bottom sheet — shared so both the header title (mailbox views)
// and the tab bar's Mail re-tap can open the same sheet.
const isFolderSheetOpen = ref(false)

export const useFolderSheet = () => {
	const openFolderSheet = () => (isFolderSheetOpen.value = true)
	const closeFolderSheet = () => (isFolderSheetOpen.value = false)

	return { isFolderSheetOpen, openFolderSheet, closeFolderSheet }
}

// Mobile selection mode — MailboxView owns the selection; the tab bar and FAB
// (mounted in DefaultLayout) hide behind the contextual action bar while it's on.
const isMobileSelectionActive = ref(false)

export const useMobileSelection = () => {
	const setMobileSelectionActive = (active: boolean) => (isMobileSelectionActive.value = active)

	return { isMobileSelectionActive, setMobileSelectionActive }
}

export const useTextEditorButtons = () => {
	const { isMobile } = useScreenSize()

	const alignButtons = ['Separator', 'Align Left', 'Align Center', 'Align Right']

	const buttons = computed(() => [
		'Paragraph',
		['Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6'],
		'Separator',
		'Bold',
		'Italic',
		'FontColor',
		...(isMobile.value ? [] : alignButtons),
		'Separator',
		'Bullet List',
		'Numbered List',
		'Separator',
		'Image',
		'Link',
	])

	return { buttons }
}

/**
 * How much of the on-screen keyboard is covering the layout viewport, as insets for holding a
 * full-screen pane clear of it.
 *
 * iOS leaves the layout viewport full-height when the keyboard opens and slides the visible part
 * around underneath it, so `position: fixed; inset: 0` runs on behind the keyboard and has to be
 * held off it by hand:
 *
 * - `bottom` is the strip the keyboard covers, so a pane ends where the keyboard starts.
 * - `top` is how far iOS has panned to reveal a focused field, so the pane rides that pan instead of
 *   being dragged off the top of the screen.
 *
 * `interactive-widget=resizes-content` (index.html) is supposed to make both of these unnecessary by
 * shrinking the layout viewport itself. It did not, on the iOS this was built against: dropping the
 * `bottom` inset put the toolbar straight back behind the keyboard. Treat these as load-bearing.
 */
export const useKeyboardInsets = () => {
	const top = ref(0)
	const bottom = ref(0)
	/** The visible height — what's left of the screen once the keyboard has taken its share. */
	const height = ref(window.innerHeight)

	const update = () => {
		const viewport = window.visualViewport
		if (!viewport) return

		height.value = viewport.height
		top.value = viewport.offsetTop
		// Against the layout viewport, not innerHeight: innerHeight tracks the visual viewport on iOS,
		// which would make this always 0 and the fallback a no-op on the browsers that need it.
		const covered = document.documentElement.clientHeight - viewport.height - viewport.offsetTop
		bottom.value = Math.max(0, Math.round(covered))
	}

	onMounted(() => {
		update()
		// `resize` is the keyboard opening and closing; `scroll` is iOS panning what's left of the
		// viewport. Missing the second is what lets a pane drift off the top of the screen.
		window.visualViewport?.addEventListener('resize', update)
		window.visualViewport?.addEventListener('scroll', update)
		window.addEventListener('resize', update)
	})

	onUnmounted(() => {
		window.visualViewport?.removeEventListener('resize', update)
		window.visualViewport?.removeEventListener('scroll', update)
		window.removeEventListener('resize', update)
	})

	return { top, bottom, height }
}

const keyboardOpen = ref(false)
let watchingFocus = false

// Input types that raise no on-screen keyboard: focusing one is not the keyboard coming up, and
// treating it as such takes the bottom bar away for a tick with nothing covering where it was.
// `shouldIgnoreKeypress` draws the same line for checkboxes.
const NON_TEXT_INPUT_TYPES = new Set([
	'button',
	'checkbox',
	'color',
	'file',
	'hidden',
	'image',
	'radio',
	'range',
	'reset',
	'submit',
])

const isEditable = (el: Element | null) => {
	if (!el) return false
	if (el.tagName === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type)
	return el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true
}

/**
 * Whether the on-screen keyboard is up, read off what's focused rather than off the viewport.
 *
 * The viewport can't answer this under `interactive-widget=resizes-content` (index.html): the
 * keyboard shrinks the layout viewport itself, so the visual and layout viewports stay the same
 * size and `useKeyboardInsets` measures zero — the very case this is for. What the shrink DOES do
 * is pull anything anchored to the bottom of the shell up above the keyboard, which is why the
 * bottom bar has to be told to step aside.
 *
 * Mobile only: desktop has no on-screen keyboard, so a focused field there means nothing and the
 * listeners aren't worth attaching.
 */
export const useKeyboardOpen = () => {
	if (!watchingFocus && isMobile.value) {
		watchingFocus = true
		// Re-read the focus on the next frame rather than trusting the event: moving between two
		// fields fires focusout before focusin, and acting on the focusout would flash the bar back
		// in between them.
		const sync = () =>
			requestAnimationFrame(() => (keyboardOpen.value = isEditable(document.activeElement)))
		document.addEventListener('focusin', sync)
		document.addEventListener('focusout', sync)
		// A field torn down with its route never fires focusout — Chrome and Safari move focus to
		// <body> silently — so this would latch on and stay on. Compose is a page whose editor is
		// focused on mount and which closes by navigating away, i.e. exactly that shape: leaving it
		// left the tab bar and its FAB hidden for the rest of the session.
		router.afterEach(() => sync())
	}
	return keyboardOpen
}

const undoAction = ref<() => void>()

export const useUndo = () => {
	const setUndoAction = (action?: () => void) => {
		undoAction.value = action
		// Clearing the undo with no replacement toast (e.g. leaving the mailbox) leaves a lingering toast
		// whose "Undo" button is now dead — dismiss toasts. When a new action is set instead, the toast it
		// raises right after (via raiseOptimisticToast/raisePromiseToast) does the removeAll, and doing it
		// here too would dismiss the reconcile paths' in-flight loading toast — so only clear on undefined.
		if (!action) toast.removeAll()
	}

	const undo = () => {
		if (!undoAction.value) return
		undoAction.value()
		undoAction.value = undefined
	}

	// Wrap the current undo so `step` runs first — lets a side effect (e.g. a junk-list entry) be
	// reverted on top of the primary undo without replacing it.
	const prependUndoAction = (step: () => void) => {
		const prev = undoAction.value
		undoAction.value = () => {
			step()
			prev?.()
		}
	}

	return { setUndoAction, undo, prependUndoAction }
}

// Shared state for the compose window. A single <SendMail> (rendered in DefaultLayout) reacts to
// this, so anything deeper in the tree — a `mailto:` link clicked inside a message, which is served
// from an iframe and can't reach it by props — can ask for a draft.
const composeRequest = ref<ComposeMailData>()

export const useComposeMail = () => ({
	composeRequest,
	requestCompose: (details: ComposeMailData) => (composeRequest.value = details),
	clearComposeRequest: () => (composeRequest.value = undefined),
})

// Shared state for the "Block sender?" prompt shown after marking/moving mail to Junk. A single
// <ScreenedEmailAddressModal> (rendered in MailboxView) reacts to this, so any view can open it.
export interface BlockableSender {
	name?: string
	email: string
}

const showBlockSender = ref(false)
const sendersToBlock = ref<BlockableSender[]>([])

// The account's own addresses, lowercased — what a thread's senders are matched against to decide
// which of them the row calls "me" (see utils/participants). Identities are per account, so a row
// merged in from another account (All Inboxes, cross-account search) is resolved against the active
// one: the cast it names is right either way, and only the "me" would go by its own name instead.
export const useOwnEmails = () => {
	const { identities } = userStore()
	return computed(
		() => new Set((identities.data ?? []).map((i: Identity) => i.email.toLowerCase())),
	)
}

export const useBlockSender = () => {
	const store = userStore()
	const { userResource, identities, screenedAddresses } = store
	const { setUndoAction, undo, prependUndoAction } = useUndo()

	// Read account/accountId off the store at call time — destructuring would snapshot the unwrapped
	// values and miss account switches while a component stays mounted.
	const activeAccount = computed(() =>
		userResource.data?.accounts?.find((a) => a.id === store.accountId),
	)

	// Senders worth offering to block: drop the user's own identities and addresses already blocked,
	// and de-duplicate by email (keeping the first occurrence's display name).
	const blockableSenders = (senders: { name?: string; email?: string }[]) => {
		const own = new Set((identities.data ?? []).map((i: Identity) => i.email))
		// "Already blocked" = screened with the Reject action (their mail is discarded), whether by their
		// exact address or by a '@domain' entry covering them.
		const blockedValues = (screenedAddresses.data ?? [])
			.filter((a: ScreenedAddress) => a.action === 'Reject')
			.map((a: ScreenedAddress) => a.email)
		const isBlocked = (email: string) => blockedValues.some((v) => matchesScreenedValue(email, v))
		const seen = new Set<string>()
		const result: BlockableSender[] = []
		for (const { name, email } of senders) {
			if (!email || own.has(email) || isBlocked(email) || seen.has(email)) continue
			seen.add(email)
			result.push({ name, email })
		}
		return result
	}

	const blockResource = createResource({
		url: 'suite.mail.api.mail.screen_email_addresses',
		makeParams: ({ emails }: { emails: string[] }) => ({
			account: store.accountId,
			emails,
			action: 'Reject',
		}),
		onSuccess: () => screenedAddresses.reload(),
	})

	const junkResource = createResource({
		url: 'suite.mail.api.mail.screen_email_addresses',
		makeParams: ({ emails }: { emails: string[] }) => ({
			account: store.accountId,
			emails,
			action: 'Spam',
		}),
		onSuccess: () => screenedAddresses.reload(),
	})

	const unjunkResource = createResource({
		url: 'suite.mail.api.mail.unscreen_email_addresses',
		makeParams: ({ emails }: { emails: string[] }) => ({
			account: store.accountId,
			emails,
		}),
		onSuccess: () => screenedAddresses.reload(),
	})

	const unblockResource = createResource({
		url: 'suite.mail.api.mail.unscreen_email_addresses',
		makeParams: ({ emails }: { emails: string[] }) => ({
			account: store.accountId,
			emails,
		}),
		onSuccess: () => screenedAddresses.reload(),
	})

	// Optimistically reflect the senders' blocked state so the immediate toast isn't lying, mirroring the
	// backend exactly: blocking adds an exact-address 'Reject' entry per sender (overriding any existing
	// rule); unblocking removes the exact-address entries — '@domain' rules that also cover a sender are
	// left in place, just as the unscreen API leaves them. Returns a revert to restore the list on failure.
	const applyScreenOptimistic = (emails: string[], block: boolean) => {
		const prev = screenedAddresses.data
		if (!prev) return () => {}
		const isExact = (a: ScreenedAddress) =>
			!a.email.startsWith('@') && emails.some((email) => matchesScreenedValue(email, a.email))
		const kept = prev.filter((a: ScreenedAddress) => !isExact(a))
		const blocked: ScreenedAddress[] = emails.map((email) => ({
			email,
			action: 'Reject',
			creation: '',
			modified: '',
		}))
		screenedAddresses.data = block ? [...kept, ...blocked] : kept
		return () => (screenedAddresses.data = prev)
	}

	// Block the senders chosen in the prompt ('Ask to Block Sender' confirm). Blocking becomes the new
	// undo action: Cmd+Z unblocks (it does not also reverse the junk move, which stays).
	const blockSenders = (senders: BlockableSender[]) => {
		const emails = senders.map((sender) => sender.email)
		if (!emails.length) return

		setUndoAction(() => {
			const revert = applyScreenOptimistic(emails, false) // optimistic: unblock reflected at once
			const forward = (async () => {
				try {
					await unblockResource.submit({ emails })
				} catch (error) {
					revert()
					throw error
				}
			})()
			const restored =
				emails.length === 1 ? __('Sender unblocked.') : __('Senders unblocked.')
			raiseOptimisticToast(forward, restored)
		})

		const revert = applyScreenOptimistic(emails, true) // optimistic: senders shown blocked at once
		const forward = (async () => {
			try {
				await blockResource.submit({ emails })
			} catch (error) {
				revert()
				throw error
			}
		})()
		const success = emails.length === 1 ? __('Sender blocked.') : __('Senders blocked.')
		raiseOptimisticToast(forward, success, undo)
	}

	// File the senders' future mail into Junk (the default 'Junk Sender's Mail'). Side effect only — the
	// caller renders the toast (see willJunkSenders) so the junk action shows a single toast, not two.
	// Undoing the junk move also drops them from the junk list (composed onto that move's undo).
	const junkSenders = (senders: BlockableSender[]) => {
		const emails = senders.map((sender) => sender.email)
		if (!emails.length) return

		junkResource.submit({ emails })
		prependUndoAction(() => unjunkResource.submit({ emails }))
	}

	// Whether marking these senders as junk will auto-file their future mail into Junk (vs prompting
	// to block, or doing nothing when there's nothing blockable). Lets the caller show one accurate toast.
	const willJunkSenders = (senders: { name?: string; email?: string }[]) =>
		blockableSenders(senders).length > 0 &&
		activeAccount.value?.on_mark_as_junk !== 'Ask to Block Sender'

	// Apply the account's 'on mark as junk' behaviour to the senders of a just-junked message:
	// 'Ask to Block Sender' opens the prompt; otherwise silently junk their future mail.
	const promptBlockSenders = (senders: { name?: string; email?: string }[]) => {
		const list = blockableSenders(senders)
		if (!list.length) return

		if (activeAccount.value?.on_mark_as_junk === 'Ask to Block Sender') {
			sendersToBlock.value = list
			showBlockSender.value = true
			return
		}
		junkSenders(list)
	}

	return { showBlockSender, sendersToBlock, willJunkSenders, promptBlockSenders, blockSenders }
}

// Navigate to the search results scoped to a sender — Gmail's "Filter messages like this". Lands on the
// filtered view (mailbox 'search') with a "From" chip the user can refine further. Shared by the message
// more-actions menu and the clickable sender address in a thread.
export const useFilterBySender = () => {
	const router = useRouter()
	// Read store.accountId live rather than destructuring, so it reflects account switches.
	const store = userStore()

	const filterBySender = (email: string) => {
		if (!email) return
		router.push({
			name: 'mail-mailbox',
			params: { accountId: store.accountId, mailbox: 'search' },
			query: { from: email },
		})
	}

	return { filterBySender }
}

// Shared state for the Settings dialog, so any view can open it (optionally on a specific tab).
// <SettingsModal> (rendered in AppSidebar) reacts to `showSettings`, and selects `settingsTab` by
// label when it opens.
const showSettings = ref(false)
const settingsTab = ref('')

export const useSettings = () => {
	const openSettings = (tab = '') => {
		settingsTab.value = tab
		showSettings.value = true
	}

	return { showSettings, settingsTab, openSettings }
}

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
const systemIsDark = ref(mediaQuery.matches)
mediaQuery.addEventListener('change', () => (systemIsDark.value = mediaQuery.matches))

const COLOR_SCHEME_CYCLE = ['System Default', 'Light Mode', 'Dark Mode'] as const

export const useTheme = () => {
	const { userResource } = userStore()

	const dataTheme = computed(() => {
		const colorScheme = userResource.data?.color_scheme || 'System Default'
		if (colorScheme === 'System Default') return systemIsDark.value ? 'dark' : 'light'
		return colorScheme === 'Dark Mode' ? 'dark' : 'light'
	})

	const updateColorScheme = createResource({
		url: 'frappe.client.set_value',
		makeParams: (color_scheme: COLOR_SCHEME) => ({
			doctype: 'User Settings',
			name: userResource.data?.user_settings,
			fieldname: { color_scheme },
		}),
		onSuccess: () => {
			// Reconcile the optimistic value against server truth (sets the same value; harmless).
			userResource.reload()
		},
	})

	// Cycle System Default → Light → Dark. Bound to Cmd/Ctrl+Shift+L app-wide (see App.vue).
	const cycleTheme = () => {
		const current = userResource.data?.color_scheme
		const idx = COLOR_SCHEME_CYCLE.indexOf(current as COLOR_SCHEME)
		const next = COLOR_SCHEME_CYCLE[(idx + 1) % COLOR_SCHEME_CYCLE.length]

		// Optimistic: flip the theme and confirm at once, before the server round-trip resolves.
		const prev = current
		if (userResource.data) userResource.data.color_scheme = next
		raiseToast(__('Color scheme updated to {0}.', [next]))

		updateColorScheme.submit(next, {
			onError: () => {
				if (userResource.data) userResource.data.color_scheme = prev
				raiseToast(__('Failed to update color scheme. Please try again later.'), 'error')
			},
		})
	}

	return { dataTheme, cycleTheme }
}
