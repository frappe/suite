<template>
  <!-- One line on a settings page for a part too big to sit on it: the button opens the part in a
       dialog. The part is built when the dialog opens, and is gone once it closes. -->
  <SettingsRow :title :description>
    <Button :label="action" :aria-label="actionName" @click="open" />
  </SettingsRow>
  <Dialog v-model:open="isOpen" :title :size>
    <!-- A part's own buttons. They sit on the title's line, left of the close button, where
         Dialog leaves room. A phone has no room there, so they keep a line of their own. -->
    <div
      ref="actions"
      class="flex items-center justify-end gap-2 empty:hidden max-md:mb-3 md:absolute md:right-16 md:top-5 md:h-7"
    />
    <slot :close />
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, SettingsRow, type DialogSize } from 'frappe-ui'
import { computed, provide, ref, useTemplateRef } from 'vue'

import {
  onSettingsSectionAsked,
  SETTINGS_DIALOG_ACTIONS_KEY,
  type SettingsSectionKey,
} from '@/platform/settings'
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

provide(SETTINGS_DIALOG_ACTIONS_KEY, useTemplateRef<HTMLElement>('actions'))

const isOpen = ref(false)
function open() {
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

onSettingsSectionAsked(() => props.section, open)
</script>
