import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createResource, toast } from 'frappe-ui'

import { matchesScreenedValue, raiseOptimisticToast, raiseToast } from '@/apps/mail/utils'
import { userStore } from '@/apps/mail/stores/user'

import type { COLOR_SCHEME, Identity, ScreenedAddress } from '@/apps/mail/types'

export const useScreenSize = () => {
	const size = reactive({ width: window.innerWidth, height: window.innerHeight })

	const isMobile = computed(() => size.width < 640)

	const onResize = () => {
		size.width = window.innerWidth
		size.height = window.innerHeight
	}

	onMounted(() => window.addEventListener('resize', onResize))

	onUnmounted(() => window.removeEventListener('resize', onResize))

	return { size, isMobile }
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

// Mobile profile bottom sheet — opened from the header avatar (any view), so the
// trigger (HeaderActions) and the mounted sheet (tab bar) stay decoupled.
const isProfileSheetOpen = ref(false)

export const useProfileSheet = () => {
	const openProfileSheet = () => (isProfileSheetOpen.value = true)
	const closeProfileSheet = () => (isProfileSheetOpen.value = false)

	return { isProfileSheetOpen, openProfileSheet, closeProfileSheet }
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

export const useVisualViewport = (calc: (viewport: VisualViewport) => string) => {
	const value = ref('0px')

	const update = () => {
		if (window.visualViewport) value.value = calc(window.visualViewport)
	}

	onMounted(() => {
		if (!window.visualViewport) return
		window.visualViewport.addEventListener('resize', update)
		window.visualViewport.addEventListener('scroll', update)

		update()

		onUnmounted(() => {
			if (!window.visualViewport) return
			window.visualViewport.removeEventListener('resize', update)
			window.visualViewport.removeEventListener('scroll', update)
		})
	})

	return value
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

// Shared state for the "Block sender?" prompt shown after marking/moving mail to Junk. A single
// <ScreenedEmailAddressModal> (rendered in MailboxView) reacts to this, so any view can open it.
export interface BlockableSender {
	name?: string
	email: string
}

const showBlockSender = ref(false)
const sendersToBlock = ref<BlockableSender[]>([])

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

type ThemeMode = 'automatic' | 'light' | 'dark'

const THEME_MODES: Record<COLOR_SCHEME, ThemeMode> = {
	'System Default': 'automatic',
	'Light Mode': 'light',
	'Dark Mode': 'dark',
}

// The applied mode is mirrored here so the pre-paint script in index.html can restore it on
// the next load — the server-rendered <html data-theme> only knows User.desk_theme, and only
// for an authenticated session, so without this the login screens (and the frames before
// boot data lands) flash light. Keep the key in sync with index.html.
const THEME_MODE_KEY = 'mail-theme-mode'

const readThemeMode = (): ThemeMode => {
	try {
		const stored = localStorage.getItem(THEME_MODE_KEY)
		if (stored === 'automatic' || stored === 'light' || stored === 'dark') return stored
	} catch {
		// Storage can be unavailable (private mode / blocked cookies) — follow the OS.
	}
	return 'automatic'
}

// Read once, at load: from here on the user's own color scheme (once fetched) is the source
// of truth, and this only fills the gap before it arrives.
const storedThemeMode = readThemeMode()

export const useTheme = () => {
	const { userResource } = userStore()

	const themeMode = computed<ThemeMode>(() => {
		const colorScheme = userResource.data?.color_scheme
		return colorScheme ? THEME_MODES[colorScheme] : storedThemeMode
	})

	const dataTheme = computed(() => {
		if (themeMode.value === 'automatic') return systemIsDark.value ? 'dark' : 'light'
		return themeMode.value
	})

	// Applied by MailLayout (the mounted mail root) on every change.
	const applyTheme = () => {
		const root = document.documentElement
		root.setAttribute('data-theme', dataTheme.value)
		root.setAttribute('data-theme-mode', themeMode.value)
		root.style.colorScheme = dataTheme.value

		try {
			localStorage.setItem(THEME_MODE_KEY, themeMode.value)
		} catch {
			// Nothing to remember with — the next load just falls back to the OS.
		}
	}

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

	return { dataTheme, applyTheme, cycleTheme }
}
