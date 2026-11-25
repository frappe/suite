<template>
  <!-- One line on a settings page for a part too big to sit on it: the button opens the part in a
       dialog. The part is built when the dialog opens, and is gone once it closes.
       On a phone the part is a page of its own that slides in over the one it is on. -->
  <SettingsRow :title :description>
    <Button :label="action" :aria-label="actionName" @click="open" />
  </SettingsRow>
  <Teleport v-if="onPhonePage" :to="pageEl ?? 'body'" :disabled="!pageEl">
    <SettingsPhonePage :open="part.shown.value" :title="partTitle" @back="part.close">
      <!-- Where a part's buttons for the whole page go, such as adding to its list; a dialog has
           them by its title. -->
      <template #actions>
        <span ref="bar" class="contents" />
      </template>
      <div class="px-4 pt-2">
        <slot :close />
        <!-- A part's own buttons, the width of the page and one above the other, as a sheet's are -->
        <div ref="actions" class="mt-10 flex flex-col gap-2 pb-4 empty:hidden *:w-full" />
      </div>
    </SettingsPhonePage>
  </Teleport>
  <Dialog v-else v-model:open="isOpen" :title="partTitle" :size>
    <!-- The title as Dialog draws it, with the part's buttons for the whole list beside it, by the
         close button: where a phone's page has them. -->
    <template #title>
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-2xl-semibold text-ink-gray-8 leading-6">{{ partTitle }}</h3>
        <span ref="bar" class="contents" />
      </div>
    </template>
    <slot :close />
    <!-- A part's own buttons. They end the dialog, spaced like Dialog's own actions -->
    <div ref="actions" class="mt-10 flex justify-end gap-2 pb-1 empty:hidden" />
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, SettingsRow, type DialogSize } from 'frappe-ui'
import { computed, inject, provide, ref, useTemplateRef } from 'vue'

import {
  onSettingsSectionAsked,
  SETTINGS_DIALOG_ACTIONS_KEY,
  SETTINGS_PART_BAR_KEY,
  SETTINGS_PHONE_PAGE_EL,
  type SettingsSectionKey,
} from '@/platform/settings'
import { useSettingsPartPage } from '@/platform/settings/partPage'
import SettingsPhonePage from '@/platform/settings/SettingsPhonePage.vue'
import { translate as __ } from '@/platform/translation'

interface Props {
  title: string
  /** The dialog's and the phone page's title, where the row's own would say too little there. */
  partTitle?: string
  description?: string
  /** The button's word, such as "Edit". */
  action: string
  size?: DialogSize
  /** The name this row goes by. Asked for by it, the row opens its dialog. */
  section?: SettingsSectionKey
}
const props = defineProps<Props>()
defineSlots<{ default?: (scope: { close: () => void }) => unknown }>()

// Read by name, as product settings bodies do: the shell sets it on its phone Settings.
const onPhonePage = inject('app-settings-mobile-page', false)
const pageEl = inject(SETTINGS_PHONE_PAGE_EL, null)

// A page has several of these, and two may share a word; read aloud, each names its part
const partTitle = computed(() => props.partTitle ?? props.title)
const actionName = computed(() => __('{0}: {1}', [props.action, props.title]))

provide(SETTINGS_DIALOG_ACTIONS_KEY, useTemplateRef<HTMLElement>('actions'))
provide(SETTINGS_PART_BAR_KEY, useTemplateRef<HTMLElement>('bar'))

// A dialog opens in place; a page of its own also takes a step in history.
const isOpen = ref(false)
const part = useSettingsPartPage()
function open() {
  if (onPhonePage) part.open()
  else isOpen.value = true
}

function close() {
  if (onPhonePage) part.close()
  else isOpen.value = false
}

onSettingsSectionAsked(() => props.section, open)
</script>
