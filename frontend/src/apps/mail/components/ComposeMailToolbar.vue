<template>
  <!-- Sticky rather than fixed: fixed positions against the layout viewport, which on iOS still spans
	     the screen with the keyboard up, so the toolbar had to be chased into place with a JS-computed
	     `bottom` — a frame behind every pan, which is what made it judder. Sticking to the bottom of the
	     scroller needs no measuring: the scroller already ends at the keyboard. -->
  <div :class="{ 'bg-surface-base sticky bottom-0 z-20': isMobile }">
    <!-- One line, always. Wrapping was decided on the groups' natural widths — nothing shrank
		     first — so a container any narrower than the two of them together dropped Discard and
		     Send onto a second row, and the docked composer's width was pinned to whatever kept that
		     from happening. Held on one line, the editor buttons give up the space instead: their
		     row is a scroller already. -->
    <div class="flex items-center gap-2 overflow-hidden pt-2.5" :class="{ 'pb-2.5': isMobile }">
      <!-- Send leads and Discard stands alone at the far end, so the two are never side by side
			     for a slip of the pointer. shrink-0 on both: whatever the line is short of comes off the
			     scrolling button row between them, never off the two things the toolbar is for. -->
      <!-- Split button: one pill, the word Send and the chevron that sends later, parted by a faint
           line inside it, so it still reads as two targets rather than one menu. -->
      <div v-if="!isMobile" class="flex shrink-0 items-center">
        <Button
          variant="solid"
          :label="__('Send')"
          :tooltip="__('Send ({0}+Enter)', [modifier])"
          :disabled="isRecipientsEmpty || isUploading"
          :loading="isSending"
          class="!rounded-r-none !pr-2"
          @click="emit('sendMail')"
        />
        <Dropdown :options="sendOptions">
          <Button
            variant="solid"
            :aria-label="__('Schedule send')"
            :tooltip="__('Schedule send ({0}+Shift+Enter)', [modifier])"
            :disabled="isRecipientsEmpty || isUploading"
            class="!rounded-l-none border-l border-white/20 dark:border-black/20"
          >
            <template #icon>
              <ChevronDown class="h-4 w-4" />
            </template>
          </Button>
        </Dropdown>
      </div>

      <ComposeSaveState
        v-if="saveState && draftSavePlacement === 'send'"
        :state="saveState"
        class="shrink-[100]"
        @retry="emit('retrySave')"
      />

      <template v-if="!isMobile">
        <ComposeReminderButton
          :remind-at
          @remind="(at: string) => emit('remind', at)"
          @clear="emit('clearRemind')"
        />
        <div class="h-4 w-[2px] shrink-0 border-l" />
      </template>
      <!-- Text editor buttons -->
      <div class="flex min-w-0 items-center gap-1 overflow-x-auto" :class="{ 'px-3': isMobile }">
        <TextEditorFixedMenu :buttons class="!bg-inherit" />
        <EmojiPicker
          v-if="!isMobile"
          v-slot="{ toggle }"
          @update:model-value="emit('appendEmoji', $event)"
        >
          <Button variant="ghost" class="max-h-6 max-w-6" @click="toggle()">
            <template #icon>
              <Laugh class="text-ink-gray-8 h-4 w-4" />
            </template>
          </Button>
        </EmojiPicker>
        <Button variant="ghost" class="max-h-6 max-w-6" @click="fileInput?.click()">
          <template #icon>
            <Paperclip class="text-ink-gray-8 h-4 w-4" />
          </template>
        </Button>
        <input ref="fileInput" type="file" class="hidden" multiple @change="onFilesSelected" />
      </div>

      <!-- Stays until a save lands, so a refused save cannot pass for a kept draft. Next to
           Discard, the one other thing on the bar that is about the draft rather than its text.
           Short of room, it wraps before the editor buttons scroll out of sight: a failing save is
           no time to lose Attach. -->
      <ComposeSaveState
        v-if="saveState && (draftSavePlacement === 'toolbar' || inThread)"
        :state="saveState"
        class="ml-auto shrink-[100]"
        @retry="emit('retrySave')"
      />
      <Button
        v-if="!isMobile"
        variant="ghost"
        class="shrink-0"
        :class="{ 'ml-auto': draftSavePlacement !== 'toolbar' && !inThread }"
        :aria-label="__('Discard')"
        :tooltip="__('Discard ({0}+D)', [modifier])"
        @click="emit('discardMail')"
      >
        <template #icon><span class="lucide-trash-2 size-4" aria-hidden="true" /></template>
      </Button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'
import { TextEditorFixedMenu } from 'frappe-ui/experimental'
import { CalendarClock, ChevronDown, Laugh, Paperclip } from 'lucide-vue-next'
import { computed, useTemplateRef } from 'vue'

import ComposeReminderButton from '@/apps/mail/components/ComposeReminderButton.vue'
import ComposeSaveState from '@/apps/mail/components/ComposeSaveState.vue'
import EmojiPicker from '@/apps/mail/components/EmojiPicker.vue'
import { isMac } from '@/apps/mail/utils'
import { useScreenSize, useTextEditorButtons } from '@/apps/mail/utils/composables'
import { draftSavePlacement } from '@/apps/mail/utils/draftSavePlacement'

const { isRecipientsEmpty, isUploading, isSending, saveState, inThread, remindAt } = defineProps<{
  isRecipientsEmpty: boolean
  isUploading?: boolean
  isSending?: boolean
  saveState?: InstanceType<typeof ComposeSaveState>['$props']['state']
  // A reply in a thread has no title bar, so its save state stays on this one.
  inThread?: boolean
  // When to be reminded if nobody replies, once asked for (see useComposeMail).
  remindAt?: string
}>()

const emit = defineEmits([
  'appendEmoji',
  'selectFiles',
  'discardMail',
  'sendMail',
  'scheduleSend',
  'remind',
  'clearRemind',
  'retrySave',
])

const modifier = computed(() => (isMac ? '⌘' : 'Ctrl'))

const sendOptions = [
  {
    label: __('Schedule send'),
    icon: CalendarClock,
    onClick: () => emit('scheduleSend'),
  },
]

const { isMobile } = useScreenSize()
const { buttons } = useTextEditorButtons(() => true)

const fileInput = useTemplateRef('fileInput')

const onFilesSelected = async (e: Event) => {
  const checkedEventTarget = e.target
  if (!(checkedEventTarget instanceof HTMLInputElement)) return

  const input = checkedEventTarget
  const files = Array.from(input.files ?? [])
  if (!files.length) return

  emit('selectFiles', files)
  input.value = ''
}
</script>

<!-- todo: file upload -> discard race condition (draft saved) -->
