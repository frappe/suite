<script setup lang="ts">
import { KeyboardShortcutsDialog, useKeyboardShortcut } from 'frappe-ui'
import { computed, onScopeDispose, provide, ref } from 'vue'
import { useRoute } from 'vue-router'

import { useKeyboardShortcuts } from '@/apps/meet/composables/useKeyboardShortcuts'
import { disposeSocket, initSocket } from '@/apps/meet/socket'
import { getPlatform } from '@/apps/meet/utils/device'

// One site socket per mount, closed on unmount so a return to Meet does not add one.
initSocket()
onScopeDispose(disposeSocket)

provide('$platform', getPlatform())

const route = useRoute()
const isInMeeting = computed(() => route.name === 'meet-meeting')

useKeyboardShortcuts(() => isInMeeting.value)

const showShortcutsDialog = ref(false)
provide('showShortcutsDialog', showShortcutsDialog)

useKeyboardShortcut({
  combo: 'Shift+Slash',
  description: 'View shortcuts',
  group: 'General',
  allowInDialog: true,
  handler: () => (showShortcutsDialog.value = true),
})
</script>

<template>
  <router-view />
  <KeyboardShortcutsDialog v-model:open="showShortcutsDialog" />
</template>
