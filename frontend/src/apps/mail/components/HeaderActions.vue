<template>
  <!-- On mobile the compose button and the sidebar sheet's Profile row own these actions; the header is
	     CSS-hidden there. Search is not among them on either: the palette answers ⌘K and has a
	     row of its own in the sidebar, and a third button for it here said the same thing twice. -->
  <div v-if="!isMobile" class="flex space-x-2">
    <!-- The view menu lays out the whole page (Split View) and the Inbox's tabs, so it sits with
         the page's actions rather than on the list's own toolbar. -->
    <ViewMenu v-if="viewMenu" :inbox="inbox" />
    <Button
      icon-left="lucide-pencil"
      :label="__('Compose')"
      :tooltip="__('Compose (C)')"
      @click="compose()"
    />
  </div>
</template>
<script setup lang="ts">
import { Button } from 'frappe-ui'
import { onMounted, onUnmounted } from 'vue'

import ViewMenu from '@/apps/mail/components/ViewMenu.vue'
import { useComposeMail, useScreenSize } from '@/apps/mail/utils/composables'

/**
 * Whether the page has the view menu: the mail lists do, Outbox doesn't. `inbox` puts the Inbox's
 * category switches in it.
 */
const { viewMenu = false, inbox = false } = defineProps<{
  viewMenu?: boolean
  inbox?: boolean
}>()

const { isMobile } = useScreenSize()
const { requestCompose } = useComposeMail()

// Asked of the layout rather than answered here, because a composer mounted in this header would be
// a composer belonging to this view: leave the mailbox for the screener and the draft goes with the
// header it was started from. The layout outlives every route in the app, so that is where the
// window lives — and it is the layout that knows a request means the dock on desktop and the
// compose page on mobile.
//
// Compose means "a new mail", always — never the draft already in the corner. A composer that is
// open loses the window to this one and closes, which costs it nothing: it saves what it holds on
// the way out, and the draft is waiting in Drafts. Reaching back for it instead made the button
// answer a request nobody had made, and left no way at all to start a second mail.
const compose = () => requestCompose({})

const handleKeydown = (e: KeyboardEvent) => {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    return

  const key = e.key.toLowerCase()

  // Compose shortcut. It reaches here with a composer already open, too — `c` starts a new mail
  // wherever it is pressed, and typing into a composer is caught by the field test above.
  if (key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault()
    compose()
  }
}

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
</script>
