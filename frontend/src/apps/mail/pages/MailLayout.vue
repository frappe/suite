<template>
  <!-- Nothing in mail works without the mail server, so an outage replaces the whole
	     route group (incl. noLayout pages) rather than decorating a UI whose every fetch
	     would fail. -->
  <MailServerUnavailableView v-if="mailServerUnavailable" class="mail-app mail-app-root" />
  <component :is="Layout" v-else class="mail-app mail-app-root">
    <router-view />
  </component>
  <ShortcutsModal v-model:open="showShortcuts" />
  <OldMailDialog v-if="!mailServerUnavailable" />
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, onUnmounted, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import DefaultLayout from '@/apps/mail/components/DefaultLayout.vue'
import MailServerUnavailableView from '@/apps/mail/components/MailServerUnavailableView.vue'
import ShortcutsModal from '@/apps/mail/components/Modals/ShortcutsModal.vue'
import OldMailDialog from '@/apps/mail/components/Screener/OldMailDialog.vue'
import { provideMailOverlayLayer } from '@/apps/mail/composables/mailOverlayLayer'
import { useChangeSync } from '@/apps/mail/composables/useChangeSync'
import { useFollowOpenFolder } from '@/apps/mail/composables/useFollowOpenFolder'
import { isMailRoute } from '@/apps/mail/router'
import { initSocket } from '@/apps/mail/socket'
import { userStore } from '@/apps/mail/stores/user'
import { shouldIgnoreKeypress } from '@/apps/mail/utils'
import { useSettings, useShortcuts, useUndo } from '@/apps/mail/utils/composables'
import dayjs from '@/apps/mail/utils/dayjs'
import { useGoToShortcuts } from '@/apps/mail/utils/goToShortcuts'
import { useGPrefix } from '@/apps/mail/utils/listNavigation'
import { mailServerUnavailable } from '@/boot/config'
import { provideAreaShortcuts } from '@/platform/shortcuts'
import { useRootStore } from '@/stores/root'

import '@/apps/mail/styles.css'

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
const { userResource } = userStore()
const router = useRouter()
const route = useRoute()

// Mail's overlay layer, where every Mail overlay teleports.
provideMailOverlayLayer()

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
const goTo = useGoToShortcuts()

// ⌘Z takes back the last undoable action, wherever it was taken. The slot is app-wide (useUndo),
// and so is what can fill it: a send is undoable from the composer window, which is open on every
// page — so the key lives here rather than in each list, where it was dead on the pages without one.
const { undo } = useUndo()

const handleGlobalShortcuts = (e: KeyboardEvent) => {
  // The listener sits on window, so it only acts while a Mail route is active.
  if (!isMailRoute(route)) return
  // Chrome fires a keydown with no key when it autofills a field.
  if (!e.key) return

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
    const destination = goTo(key)
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
useChangeSync(socket, () => mailServerUnavailable.value)

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

useFollowOpenFolder()

onMounted(() => {
  window.addEventListener('keydown', handleGlobalShortcuts)
  window.addEventListener('focusout', resetDocumentScroll)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalShortcuts)
  window.removeEventListener('focusout', resetDocumentScroll)
})
</script>
