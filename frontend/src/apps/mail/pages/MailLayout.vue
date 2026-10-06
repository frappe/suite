<template>
  <!-- Nothing in mail works without the mail server, so an outage replaces the whole
	     route group (incl. noLayout pages) rather than decorating a UI whose every fetch
	     would fail. -->
  <MailServerUnavailableView v-if="mailServerUnavailable" class="mail-app mail-app-root" />
  <component :is="Layout" v-else class="mail-app mail-app-root">
    <router-view />
  </component>
  <ShortcutsModal v-model:open="showShortcuts" />
</template>

<script setup lang="ts">
import { providePortalTarget } from 'frappe-ui'
import { computed, onMounted, onScopeDispose, onUnmounted, provide, watch } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'

import DefaultLayout from '@/apps/mail/components/DefaultLayout.vue'
import MailServerUnavailableView from '@/apps/mail/components/MailServerUnavailableView.vue'
import ShortcutsModal from '@/apps/mail/components/Modals/ShortcutsModal.vue'
import { isMailRoute } from '@/apps/mail/router'
import { initSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import { shouldIgnoreKeypress } from '@/apps/mail/utils'
import { useSettings, useShortcuts, useUndo } from '@/apps/mail/utils/composables'
import dayjs from '@/apps/mail/utils/dayjs'
import { useGPrefix } from '@/apps/mail/utils/listNavigation'
import {
  currentMailboxParam,
  INBOX_FOLDER,
  unifiedFolderRoute,
} from '@/apps/mail/utils/unifiedFolders'
import { provideAreaShortcuts } from '@/platform/shortcuts'
import { mailServerUnavailable } from '@/boot/config'
import { useRootStore } from '@/stores/root'

/**
 * Mail route-group layout.
 *
 * The suite shell already provides the top-level chrome, and the platform provides the one
 * FrappeUIProvider and registers the push service worker, but neither provides mail's
 * `$user` / `$dayjs` / `$socket` injects. So this layout:
 *   - provides the mail-local `$user` / `$dayjs` / `$socket` injections, and closes the
 *     socket when it unmounts,
 *   - owns Mail's overlay layer, where every Mail overlay teleports,
 *   - picks the inner layout (DefaultLayout / bare div for noLayout routes),
 *   - renders the nested <router-view>.
 *
 * Public pre-auth routes (login/signup/...) sit OUTSIDE this layout since they
 * do not need the $user/$dayjs/$socket injects.
 */
const { userResource, mailboxIds, accountId } = userStore()
const router = useRouter()
const route = useRoute()

// Mail's overlay layer. frappe-ui overlays (Dialogs, Dropdowns, Popovers, BottomSheets) and
// Mail's own full-screen panes teleport here instead of to bare <body>, so the Mail styles
// below reach them through `.mail-app` without a class on <body>. Nothing Mail styles then
// reaches the document, the shell, or another area. The layer is a plain block at the end of
// <body>: it makes no stacking context, so the overlays stack as they did on <body>. It exists
// from setup on, before any child mounts a Teleport, and leaves with the layout.
const overlayLayer = document.createElement('div')
overlayLayer.className = 'mail-app'
document.body.append(overlayLayer)
providePortalTarget(overlayLayer)
onScopeDispose(() => overlayLayer.remove())

// `?` and the `g`+letter mailbox jumps belong to the whole non-admin app, not to whichever
// list happens to be mounted: they were only reachable from a mailbox view before, so they
// died in All Inboxes, the Screener and the settings pages. The admin dashboard sits under
// its own layout and never sees these.
const { showShortcuts, openShortcuts } = useShortcuts()
provideAreaShortcuts(openShortcuts)
const gPrefix = useGPrefix()

// `g` is also the prefix each list uses for its own g g / G jump to the ends. Both listeners
// see the key and keep their own prefix state; this one only ever acts on a following letter,
// so a `g g` falls through to the list untouched.
// `g` then a letter. Beyond the account's own folders this reaches the three views that are not
// folders at all — the merged list, the Screener and the Outbox — so the map holds routes, not
// mailbox ids.
//
// `a` is the Inbox of all accounts (as in Gmail's All Mail), which pushes Archive to `e` — the letter that
// already archives a thread, so one letter means archive throughout. The Screener takes `r` for
// review: `s` is Sent, and `c` would collide with Contacts if that ever gets a jump.
const mailboxRoute = (mailbox: string) => ({ name: 'mail-mailbox', params: { accountId, mailbox } })

const GO_TO_KEYS: Record<string, () => RouteLocationRaw> = {
  a: () => unifiedFolderRoute(INBOX_FOLDER),
  r: () => ({ name: 'mail-screener', params: { accountId } }),
  o: () => ({ name: 'mail-outbox', params: { accountId } }),
  i: () => mailboxRoute(mailboxIds.inbox),
  f: () => mailboxRoute('starred'),
  s: () => mailboxRoute(mailboxIds.sent),
  d: () => mailboxRoute(mailboxIds.drafts),
  j: () => mailboxRoute(mailboxIds.junk),
  e: () => mailboxRoute(mailboxIds.archive),
  t: () => mailboxRoute(mailboxIds.trash),
}

// ⌘Z takes back the last undoable action, wherever it was taken. The slot is app-wide (useUndo),
// and so is what can fill it: a send is undoable from the composer window, which is open on every
// page — so the key lives here rather than in each list, where it was dead on the pages without one.
const { undo } = useUndo()

const handleGlobalShortcuts = (e: KeyboardEvent) => {
  // The listener sits on window, so it only acts while a Mail route is active.
  if (!isMailRoute(route)) return

  const key = e.key.toLowerCase()

  // Above the guard, which drops every modified key: this is the one shortcut here that has one.
  if ((e.metaKey || e.ctrlKey) && key === 'z' && !shouldIgnoreKeypress(e, true)) {
    e.preventDefault()
    gPrefix.disarm()
    return undo()
  }

  if (shouldIgnoreKeypress(e)) return

  if (e.key === '?') {
    e.preventDefault()
    showShortcuts.value = true
    return
  }

  if (gPrefix.armed.value) {
    const destination = GO_TO_KEYS[key]?.()
    gPrefix.disarm()
    if (!destination) return
    e.preventDefault()
    router.push(destination)
    return
  }

  if (key === 'g') gPrefix.press(e.shiftKey)
}
const { openSettings } = useSettings()

const unregisterPaletteGroups = useRootStore().registerPaletteGroups('mail-layout', () =>
  mailServerUnavailable.value
    ? []
    : [
        {
          commands: [
            {
              id: 'mail-settings',
              label: 'Settings',
              shortcut: 'Mod+Shift+Comma',
              enterHint: 'open settings',
              icon: 'lucide-settings',
              run: () => openSettings('mail.credentials'),
            },
          ],
        },
      ],
)
onScopeDispose(unregisterPaletteGroups)

provide('$user', userResource)
provide('$dayjs', dayjs)
// One site socket per mount, closed on unmount, so a return to Mail does not add a second.
const socket = initSocket()
provide('$socket', socket)
onScopeDispose(() => socket.disconnect())

const Layout = computed(() => {
  if (route.meta.noLayout) return 'div'
  return DefaultLayout
})

// iOS standalone scrolls the whole document to reveal a focused input above the
// keyboard, and can leave that offset behind after dismissal — the entire shell
// then sits displaced (rows under the clock, bottom nav mid-screen, void below).
// Every scroller in the app is internal, so a document offset is always dirt;
// sweep it whenever focus leaves a field. rAF: let the keyboard dismissal settle
// first, and never fight iOS while the field is still focused.
const resetDocumentScroll = () => {
  requestAnimationFrame(() => {
    if (window.scrollY) window.scrollTo(0, 0)
  })
}

// The URL names an account's folder by its slug, which a rename changes — or a delete takes away —
// while the folder is open. Follow it to its new name, or out to the account's default folder, rather
// than leave the URL naming nothing (see utils/unifiedFolders).
const mailStore = userStore()
watch(
  () => [route.name, route.params.mailbox, mailStore.mailboxes.data] as const,
  ([name, param, mailboxes]) => {
    if ((name !== 'mail-mailbox' && name !== 'mail-mail') || !mailboxes) return
    const next = currentMailboxParam(route.params.accountId, param, mailboxes)
    if (next === param) return
    if (next === null)
      return router.replace({
        name: 'mail-account-shortcut',
        params: { accountId: route.params.accountId },
      })
    router.replace({
      name,
      params: { ...route.params, mailbox: next },
      query: route.query,
      hash: route.hash,
    })
  },
)

onMounted(() => {
  window.addEventListener('keydown', handleGlobalShortcuts)
  window.addEventListener('focusout', resetDocumentScroll)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalShortcuts)
  window.removeEventListener('focusout', resetDocumentScroll)
})
</script>

<style>
/* Mail styles. Every rule sits under `.mail-app`: Mail's layout root and Mail's overlay layer
   (see `overlayLayer`), so no rule reaches the document, the shell, or another area. The
   suite's global css already imports frappe-ui/style.css, so we only carry the mail base type
   sizing, the heading rules, and the shared `.icon` helper. frappe-ui design *tokens* are
   referenced via their CSS variables (NOT @apply, which would break the build for these
   plugin-registered token classes); plain Tailwind utilities below still use @apply. */
.mail-app-root {
  @apply text-lg sm:text-md text-ink-gray-8 bg-surface-base;
}

/* The overlay layer has no text colour of its own, so un-classed text in a teleported
   dialog or menu (modal <h1> titles, for one) would fall back to black. */
.mail-app {
  color: var(--ink-gray-8);
}

.mail-app h1 {
  @apply !font-semibold;
}

.mail-app h2 {
  @apply text-lg !font-medium sm:text-md;
}

/* :where() keeps the helper at the one-class weight it had as a bare `.icon`. */
:where(.mail-app) .icon {
  stroke-width: 1.5;
  width: 1rem;
  height: 1rem;
  color: var(--ink-gray-6);
}

/* The mail app's icon weight is 1.5 (.icon, FeatherIcon's default, and
   frappe-ui's ~icons pipeline all agree), but icons imported straight from
   lucide-vue-next ship stroke-width 2 — so default every lucide svg to 1.5
   instead of repeating the attribute at each call site. :where() keeps the
   rule at zero specificity, so an explicit stroke-* utility (e.g. stroke-2
   on a button) still wins. Covers teleported menus/sheets too, through
   the overlay layer. */
:where(.mail-app svg.lucide) {
  stroke-width: 1.5;
}

/* Swipe paging (mobile) — shared by the thread pane (MailThread) and the screener
   preview: the incoming page slides in from the swipe side while the outgoing one —
   lifted out of flow so they overlap — slides away in tandem. */
.mail-app .page-next-enter-active,
.mail-app .page-next-leave-active,
.mail-app .page-prev-enter-active,
.mail-app .page-prev-leave-active {
  transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}

.mail-app .page-next-leave-active,
.mail-app .page-prev-leave-active {
  position: absolute;
  inset: 0;
}

.mail-app .page-next-enter-from,
.mail-app .page-prev-leave-to {
  transform: translateX(100%);
}

.mail-app .page-next-leave-to,
.mail-app .page-prev-enter-from {
  transform: translateX(-100%);
}
</style>
