<template>
  <!-- Keyed so each request starts a fresh draft rather than resuming the last one. Desktop
	     only: a phone composes on its own page, which `open` goes to instead. -->
  <SendMail
    v-if="!isMobile"
    :key="composeKey"
    v-model="showCompose"
    :mail-details="composeDetails"
    :account="composeDetails?.account"
    :closes-with-page="away"
    @reload-mails="requestListReload()"
  />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import SendMail from '@/apps/mail/components/SendMail.vue'
import { openComposePage } from '@/apps/mail/composables/composeHandoff'
import { userStore } from '@/apps/mail/stores/user'
import type { ComposeMailData } from '@/apps/mail/types'
import { useComposeMail, useListReload, useScreenSize } from '@/apps/mail/utils/composables'
import { composeLink } from '@/apps/mail/utils/composeLink'

/**
 * Mail's composer for whatever page is on screen: a window over the page on a desktop, the compose
 * page on a phone. It answers every compose request (`useComposeMail().requestCompose`): another
 * app writing to someone, a `mailto:` link in a message, the Undo of a discarded draft. Mount one
 * per page — Mail's layout does, and so does another app's page (see mountComposeHost.ts), which
 * sets `away`.
 */
const { away = false } = defineProps<{
  /**
   * On another app's page, outside Mail. A phone goes to Mail by its compose link there, as Mail's
   * routes may not be loaded yet. With no Mail account, a desktop hands the people to the device's
   * mail app instead of a window that could not send.
   */
  away?: boolean
}>()

const store = userStore()
const router = useRouter()
const { isMobile } = useScreenSize()
const { requestListReload } = useListReload()

const showCompose = ref(false)
const composeKey = ref(0)
const composeDetails = ref<ComposeMailData>()

const open = (details: ComposeMailData) => {
  // Mobile has no composer window to open — compose is a page there, and the draft travels to it
  // through the handoff.
  if (isMobile.value) {
    if (away) void router.push(composeLink(details.to ?? []))
    else void openComposePage(router, details.account ?? store.accountId, details)
    return
  }
  if (away && !store.accountId) {
    const to = (details.to ?? []).map(({ email }) => encodeURIComponent(email))
    window.open(`mailto:${to.join(',')}`, '_self')
    return
  }
  composeDetails.value = details
  // Remount, so a second request replaces the draft on screen instead of being swallowed by the
  // composer already holding one.
  composeKey.value++
  showCompose.value = true
}

// Immediate: a request can come before the host mounts — another app's first, made while Mail's
// user was still loading, or an Undo pressed while no host was on the page.
const { composeRequest, clearComposeRequest } = useComposeMail()
watch(
  composeRequest,
  (details) => {
    if (!details) return
    open(details)
    clearComposeRequest()
  },
  { immediate: true },
)
</script>
