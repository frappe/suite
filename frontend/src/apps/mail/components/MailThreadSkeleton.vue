<template>
  <!-- A thread before its messages arrive, in the shape an open one takes (see MailThread): the
       subject, then one message with its sender row and a few lines of body. The paddings and the
       line boxes are the thread's own, so the subject and the sender land where their outlines
       stood. With `toolbar`, the whole pane: the thread's toolbar row in outline above it, for a
       list that mounts the pane only once the open thread's row is in. -->
  <div
    class="animate-pulse"
    :class="{ 'flex h-full flex-col overflow-hidden': toolbar }"
    role="status"
    :aria-label="__('Loading thread')"
  >
    <div v-if="toolbar" :class="THREAD_TOOLBAR_BOX_CLASS" aria-hidden="true">
      <!-- Back's place, then the buttons, then the arrows' corner on a desktop. -->
      <ThreadButtonOutline class="mr-2 max-sm:-ml-2" />
      <div class="flex min-w-0 flex-1 items-center gap-4 max-sm:gap-3">
        <ThreadActionsOutline :drafts />
        <div v-if="!isMobile" class="!ml-auto flex space-x-2">
          <ThreadButtonOutline v-for="n in 2" :key="n" />
        </div>
      </div>
    </div>

    <div class="sm:px-5 sm:pt-5">
      <!-- Subject: the heading's one line. -->
      <div class="flex h-7 items-center box-content max-sm:px-3.5 max-sm:py-3 sm:pb-2">
        <div class="bg-surface-gray-3 h-4 w-3/5 rounded-4" />
      </div>

      <div class="max-sm:px-3.5 max-sm:py-5 sm:mt-2">
        <!-- A phone puts the date on a row of its own, above the sender. -->
        <div v-if="isMobile" class="flex h-7 items-center pb-2 box-content">
          <div class="bg-surface-gray-3 h-3 w-24 rounded-4" />
        </div>

        <!-- Sender row: avatar, name and address over the recipients, the date at its end. -->
        <div class="flex items-start space-x-3 pb-6">
          <div class="bg-surface-gray-3 h-10 w-10 shrink-0 rounded-full" />
          <div class="flex min-w-0 flex-1 justify-between">
            <div class="min-w-0">
              <div class="flex h-6 items-center space-x-1.5">
                <div class="bg-surface-gray-3 h-3.5 w-28 rounded-4" />
                <div class="bg-surface-gray-3 h-3 w-44 rounded-4 max-sm:hidden" />
              </div>
              <div class="flex h-5 items-center">
                <div class="bg-surface-gray-3 h-3 w-20 rounded-4" />
              </div>
            </div>
            <div v-if="!isMobile" class="flex h-6 shrink-0 items-center">
              <div class="bg-surface-gray-3 h-3 w-28 rounded-4" />
            </div>
          </div>
        </div>

        <!-- Body: a few lines of text. -->
        <div class="space-y-3">
          <div
            v-for="(width, i) in lineWidths"
            :key="i"
            class="bg-surface-gray-3 h-2.5 rounded-4"
            :style="{ width }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ThreadActionsOutline from '@/apps/mail/components/ThreadActionsOutline.vue'
import ThreadButtonOutline from '@/apps/mail/components/ThreadButtonOutline.vue'
import { THREAD_TOOLBAR_BOX_CLASS } from '@/apps/mail/constants'
import { useScreenSize } from '@/apps/mail/utils/composables'

// `toolbar`: stand in for the whole reading pane, its toolbar row too. `drafts`: the thread is
// opened from Drafts, whose toolbar has one button.
const { toolbar = false, drafts = false } = defineProps<{ toolbar?: boolean; drafts?: boolean }>()
const { isMobile } = useScreenSize()

// Fixed, so the lines don't shuffle on each render.
const lineWidths = ['90%', '75%', '82%', '60%', '88%', '45%']
</script>
