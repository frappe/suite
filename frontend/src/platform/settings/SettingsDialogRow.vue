<template>
  <!-- One line on a settings page for a part too big to sit on it: the button opens the part in a
       dialog. The part is built when the dialog opens, and is gone once it closes. -->
  <SettingsRow :title :description>
    <Button :label="action" :aria-label="actionName" @click="open" />
  </SettingsRow>
  <Dialog v-model:open="isOpen" :title :size>
    <slot :close />
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, SettingsRow, type DialogSize } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { settingsSection, type SettingsSectionKey } from '@/platform/settings'
import { translate as __ } from '@/platform/translation'

interface Props {
  title: string
  description?: string
  /** The button's word, such as "Edit". */
  action: string
  size?: DialogSize
  /** The name this row goes by. Asked for by it, the row opens its dialog. */
  section?: SettingsSectionKey
}
const props = defineProps<Props>()
defineSlots<{ default?: (scope: { close: () => void }) => unknown }>()

// A page has several of these, and two may share a word; read aloud, each names its part
const actionName = computed(() => __('{0}: {1}', [props.action, props.title]))

const isOpen = ref(false)
function open() {
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

function openWhenAskedFor() {
  if (props.section && settingsSection.value === props.section) {
    // Answered once: coming back to the page later must not open it again
    settingsSection.value = undefined
    open()
  }
}

watch(settingsSection, openWhenAskedFor, { immediate: true })
</script>
