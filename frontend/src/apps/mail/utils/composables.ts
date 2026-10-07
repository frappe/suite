import { toast } from 'frappe-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, client } from '@/api'
import router from '@/apps/mail/router'
import type { mailSettings } from '@/apps/mail/settings'
import { userStore } from '@/apps/mail/stores/user'
import type { ComposeMailData, Identity } from '@/apps/mail/types'
import { createSwipeGesture } from '@/apps/mail/utils/swipeGesture'
import {
  INBOX_FOLDER,
  isUnifiedRoute,
  mailboxForUnifiedFolder,
  rememberUnified,
  unifiedFolderFor,
  unifiedFolderRoute,
} from '@/apps/mail/utils/unifiedFolders'
import { useScreenSize } from '@/composables/useScreenSize'
import { useTheme as useSuiteTheme } from '@/composables/useTheme'
import { openSettings as openSuiteSettings } from '@/shell/settings/useSettingsDialog'
import { useRootStore } from '@/stores/root'

// Re-exported from the suite-wide composable so mail's many callers keep one import, and so the
// calendar reads the same ref rather than a second copy of the same window width. Imported at the
// top rather than `export ... from`, which would re-export the name without binding it here — this
// file calls it too.
export { useScreenSize }

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
 * Flipping Split View from the list toolbar. Mail layout settings writes the same field behind a
 * Save button; this one is a layout switch, so it applies on click — the local value flips first
 * and the whole split re-lays out from it, then rolls back if the write doesn't land.
 */
export const useToggleReadingPane = () => {
  const { userResource } = userStore()
  return () => {
    const user = userResource.data
    if (!user) return
    return client.mutation(api.mail.settings.updatePreferences, {
      show_reading_pane: user.show_reading_pane ? 0 : 1,
    })
  }
}

/**
 * Switching accounts stays in place wherever the view allows it — shared by the
 * sidebar's account submenu and the mobile profile sheet. Account-scoped routes
 * swap the accountId param in their own URL. Everything else goes through the
 * account shortcut, which the guard resolves to the new account's default mailbox.
 *
 * "All accounts" is a mode of the same switcher, and the folder carries across it
 * both ways: Sent in one account opens the merged Sent, and the merged Sent opens
 * the chosen account's Sent — its inbox when it has no such folder.
 */
export const useAccountSwitch = () => {
  const route = useRoute()
  const router = useRouter()
  const store = userStore()

  const switchAccount = async (accountId: string) => {
    // Picking an account, anywhere, ends "All accounts".
    rememberUnified(false)
    if (isUnifiedRoute(route.name)) {
      const mailboxes =
        accountId === store.accountId
          ? store.mailboxes.data
          : await client.query(api.mail.mailboxes.list, { account: accountId }).catch(() => null)
      const mailbox = mailboxForUnifiedFolder(route.params.folder, mailboxes)
      return router.push(
        mailbox
          ? { name: 'mail-mailbox', params: { accountId, mailbox } }
          : { name: 'mail-account-shortcut', params: { accountId } },
      )
    }
    if (accountId === store.accountId) return
    router.push(
      route.params.accountId
        ? {
            name: route.name!,
            params: {
              ...route.params,
              accountId,
            },
          }
        : {
            name: 'mail-account-shortcut',
            params: {
              accountId,
            },
          },
    )
  }

  const switchToAll = () => {
    if (isUnifiedRoute(route.name)) return
    rememberUnified(true)
    const inMailbox = route.name === 'mail-mailbox' || route.name === 'mail-mail'
    router.push(
      unifiedFolderRoute(
        inMailbox ? unifiedFolderFor(route.params.mailbox, store.mailboxes.data) : INBOX_FOLDER,
      ),
    )
  }

  return { switchAccount, switchToAll }
}

// Horizontal swipe-to-page detection, shared by the mailbox thread pane and the screener
// preview: left → onSwipe(1) (next), right → onSwipe(-1). The rule itself lives in
// createSwipeGesture; this binds it to the touch events and to the view. Judged on
// touchend (passive) so vertical scrolling is never delayed. Swipes over an email body
// never reach the pane: EmailContent detects them inside its iframe and re-broadcasts
// them as `email-swipe` window events, which this subscribes to as well. The time guard
// dedupes those (every mounted EmailContent re-dispatches the same message) and paces
// direct swipes alike.
export const useSwipeNav = (enabled: () => boolean, onSwipe: (offset: 1 | -1) => void) => {
  const gesture = createSwipeGesture()
  let lastSwipeAt = 0
  const swipe = (offset: 1 | -1) => {
    if (!enabled()) return
    const now = Date.now()
    if (now - lastSwipeAt < 250) return
    lastSwipeAt = now
    onSwipe(offset)
  }
  const onTouchStart = (e: TouchEvent) => {
    if (!enabled()) return gesture.cancel()
    gesture.start(e.touches[0].clientX, e.touches[0].clientY, e.touches.length)
  }
  const onTouchMove = (e: TouchEvent) => {
    const touch = e.touches[0]
    if (touch) gesture.move(touch.clientX, touch.clientY)
  }
  const onTouchEnd = (e: TouchEvent) => {
    const offset = gesture.end(e.changedTouches[0].clientX, e.changedTouches[0].clientY)
    if (offset) swipe(offset)
  }
  const onEmailSwipe = (e: Event) => swipe((e as CustomEvent).detail === 'left' ? 1 : -1)
  onMounted(() => window.addEventListener('email-swipe', onEmailSwipe))
  onUnmounted(() => window.removeEventListener('email-swipe', onEmailSwipe))
  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  }
}

// The search page's address — the one place that knows it is the mailbox route with the virtual
// 'search' mailbox — for whoever sends someone there: the palette, the results header, the phone.
export const mailSearchRoute = (accountId: string, query: Record<string, string> = {}) => ({
  name: 'mail-mailbox',
  params: {
    accountId,
    mailbox: 'search',
  },
  query,
})
export const useMobileSearch = () => {
  const route = useRoute()
  const router = useRouter()
  const store = userStore()
  const root = useRootStore()
  const isSearchRoute = computed(
    () => route.name === 'mail-mailbox' && route.params.mailbox === 'search',
  )

  // Keep the search route behind the palette so browser Back dismisses search and the
  // route watcher in DefaultLayout closes the palette.
  const openSearch = async () => {
    if (!isSearchRoute.value) await router.push(mailSearchRoute(store.accountId))
    root.paletteOpen = true
  }

  // `all_accounts` is the search's scope, not a condition: a route carrying only that has no
  // search on it.
  const hasSearchQuery = computed(() =>
    Object.keys(route.query).some((key) => key !== 'all_accounts'),
  )

  // The palette's open state, for the layout that hides the compose button behind it and
  // closes it when the search route is left.
  const paletteOpen = computed({
    get: () => root.paletteOpen,
    set: (open: boolean) => (root.paletteOpen = open),
  })
  return {
    hasSearchQuery,
    isSearchRoute,
    openSearch,
    paletteOpen,
  }
}

// Mobile selection mode — MailboxView owns the selection; the compose button
// (mounted in DefaultLayout) hides behind the contextual action bar while it's on.
const isMobileSelectionActive = ref(false)
export const useMobileSelection = () => {
  const setMobileSelectionActive = (active: boolean) => (isMobileSelectionActive.value = active)
  return {
    isMobileSelectionActive,
    setMobileSelectionActive,
  }
}

/**
 * `dropAlignment` is the mail composer, which does without the alignment group: it was the widest
 * thing in a toolbar that has to fit a narrow docked panel, alignment in an email body is rare,
 * and mobile had already dropped it — so the composer's toolbar no longer changes shape with the
 * window it is in. The signature and vacation editors keep it, where centring a logo or a footer
 * is the point. A getter, so a caller can make it conditional.
 */
export const useTextEditorButtons = (dropAlignment: () => boolean = () => false) => {
  const { isMobile } = useScreenSize()
  const alignButtons = ['Separator', 'Align Left', 'Align Center', 'Align Right']
  const buttons = computed(() => [
    'Paragraph',
    ['Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6'],
    'Separator',
    'Bold',
    'Italic',
    'FontColor',
    ...(isMobile.value || dropAlignment() ? [] : alignButtons),
    'Separator',
    'Bullet List',
    'Numbered List',
    'Separator',
    'Image',
    'Link',
  ])
  return {
    buttons,
  }
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
  const { isMobile } = useScreenSize()
  if (!watchingFocus && isMobile.value) {
    watchingFocus = true
    // Re-read the focus on the next frame rather than trusting the event: moving between two
    // fields fires focusout before focusin, and acting on the focusout would flash the nav back
    // in between them.
    const sync = () =>
      requestAnimationFrame(() => (keyboardOpen.value = isEditable(document.activeElement)))
    document.addEventListener('focusin', sync)
    document.addEventListener('focusout', sync)
    // A field torn down with its route never fires focusout — Chrome and Safari move focus to
    // <body> silently — so this would latch on and stay on. Compose is a page whose editor is
    // focused on mount and which closes by navigating away, i.e. exactly that shape: leaving it
    // left the bottom nav and the compose button hidden for the rest of the session.
    router.afterEach(() => sync())
  }
  return keyboardOpen
}
const undoAction = ref<() => void>()

// The action in the slot that is the app's rather than a view's, if that is what is there. A list's
// undo puts rows back into a list that has to still be on screen, so it dies with its view; a send's
// undo is a server call, as good from the next page as from this one, and stays.
let outlivingAction: (() => void) | undefined
export const useUndo = () => {
  const setUndoAction = (action?: () => void, { outlivesView = false } = {}) => {
    undoAction.value = action
    outlivingAction = outlivesView ? action : undefined
    // Clearing the undo with no replacement toast (e.g. leaving the mailbox) leaves a lingering toast
    // whose "Undo" button is now dead — dismiss toasts. When a new action is set instead, the toast it
    // raises right after (via raiseOptimisticToast/raisePromiseToast) does the dismiss, and doing it
    // here too would dismiss the reconcile paths' in-flight loading toast — so only clear on undefined.
    if (!action) toast.dismiss()
  }

  // What a view does on the way out: its own undo goes, toast and all, so nothing can undo into a
  // list that is no longer there. An undo that outlives views is left alone, toast included.
  const dropViewUndo = () => {
    if (undoAction.value && undoAction.value === outlivingAction) return
    setUndoAction(undefined)
  }
  const undo = () => {
    if (!undoAction.value) return
    undoAction.value()
    undoAction.value = undefined
  }

  // Take one action out of the slot, and only if it is still the one there: for an undo that lapses
  // on its own — a send, once the server's hold is over. Unlike clearing, it leaves the toasts alone:
  // this action's is long gone by then, and whatever is on screen belongs to a later one.
  const retireUndoAction = (action: () => void) => {
    if (undoAction.value === action) undoAction.value = undefined
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
  return {
    setUndoAction,
    undo,
    prependUndoAction,
    retireUndoAction,
    dropViewUndo,
  }
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

// That composer outlives the route it was started on, which is the point of it — a draft begun in
// the inbox is still there in the screener. It also means the list it affects is no longer an
// ancestor it can hand an event to: a mail sent or a draft saved is announced here instead, and
// whichever list is on screen answers in its own terms — the mailbox resets Drafts and Sent, All
// Inboxes refreshes in place, the screener reloads its senders.
const listReloadRequest = ref(0)
export const useListReload = () => ({
  listReloadRequest,
  requestListReload: () => listReloadRequest.value++,
})

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
      params: {
        accountId: store.accountId,
        mailbox: 'search',
      },
      query: {
        from: email,
      },
    })
  }
  return {
    filterBySender,
  }
}

/** A Mail tab in the Suite Settings list, for example `'mail.screener'`. */
export type MailSettingsTabId = (typeof mailSettings.tabs)[number]['id']

// Every Mail entry point opens the Suite Settings dialog on a Mail tab. This is Mail's one
// import of the shell's Settings [T018].
export const useSettings = () => ({
  openSettings: (tab: MailSettingsTabId) => openSuiteSettings(tab),
})
const showShortcuts = ref(false)
export const useShortcuts = () => ({
  showShortcuts,
  openShortcuts: () => (showShortcuts.value = true),
})
export const useTheme = () => useSuiteTheme()
