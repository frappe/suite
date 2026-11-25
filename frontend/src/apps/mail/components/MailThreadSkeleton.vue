<template>
  <!-- A thread before its messages arrive, in the shape an open one takes (see MailThread): the
       subject, then one message with its sender row and a few lines of body. The paddings and the
       line boxes are the thread's own, so the subject and the sender land where their outlines
       stood. As a peek — the thread a swipe is bringing in — it shows the subject and the sender
       the list already has, standing still. -->
  <div
    class="min-h-full"
    :class="{ 'animate-pulse': !peek }"
    :role="peek ? undefined : 'status'"
    :aria-label="peek ? undefined : __('Loading thread')"
  >
    <div class="sm:px-5 sm:pt-5">
      <!-- Subject: the heading's one line, or as many as a peek's subject takes, wrapped as the
           heading wraps it. -->
      <div
        class="flex min-h-7 items-center box-content max-sm:px-4 max-sm:pb-2 max-sm:pt-1 sm:pb-2"
      >
        <div
          v-if="peek"
          class="text-ink-gray-8 text-xl-semibold min-w-0 flex-1 break-words !leading-7"
        >
          {{ peek.subject || __('[No subject]') }}
        </div>
        <div v-else class="bg-surface-gray-3 h-4 w-3/5 rounded-4" />
      </div>

      <!-- One message, bare as a lone one stands (see MailThread): on a phone, on the subject's
           axis, without a card. -->
      <div class="max-sm:mt-2 max-sm:px-4 max-sm:pb-4 max-sm:pt-1 sm:mt-2">
        <!-- Sender: avatar, then the name (and on a desktop the address) over the recipients, over
             the date, in the open message's 24, 16 and 20px rows; a phone's recipients take a 20px
             line. The bars are about as long as what they stand for. -->
        <div class="flex items-start space-x-3 pb-6 max-sm:pb-4">
          <!-- A phone's is 36px, a little down, as the open message's is; a peek's is that one. -->
          <Avatar
            v-if="peek"
            :label="peek.initial"
            :image="peek.image"
            size="xl"
            :class="['mt-1 size-9']"
          />
          <div
            v-else
            class="bg-surface-gray-3 size-10 shrink-0 rounded-full max-sm:mt-1 max-sm:size-9"
          />
          <!-- text-sm, as the open message's column is: its tracking carries to the larger name. -->
          <div class="min-w-0 flex-1 text-sm">
            <!-- Uncoloured, as the open message's name is. -->
            <div v-if="peek" class="truncate text-[15px] font-semibold leading-6">
              {{ peek.sender }}
            </div>
            <div v-else class="flex h-6 items-center space-x-1.5">
              <div class="bg-surface-gray-3 h-3.5 w-28 rounded-4" />
              <div class="bg-surface-gray-3 h-3 w-44 rounded-4 max-sm:hidden" />
            </div>
            <!-- A peek's are the open message's own lines, so nothing changes as it lands. -->
            <template v-if="peek">
              <div v-if="peek.to" class="flex h-5 items-center space-x-1.5 leading-5">
                <span class="truncate">{{ peek.to }}</span>
                <ChevronDown class="text-ink-gray-6 mt-px h-3.5 w-3.5 shrink-0" />
              </div>
              <div class="mt-1 flex h-5 items-center">
                <MailDate :datetime="peek.receivedAt" />
              </div>
            </template>
            <template v-else>
              <div class="flex h-4 items-center max-sm:h-5">
                <div class="bg-surface-gray-3 h-3 w-36 rounded-4" />
              </div>
              <div class="mt-1 flex h-5 items-center">
                <div class="bg-surface-gray-3 h-3 w-24 rounded-4" />
              </div>
            </template>
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
import { Avatar } from 'frappe-ui'
import { ChevronDown } from 'lucide-vue-next'

import MailDate from '@/apps/mail/components/MailDate.vue'
import type { ThreadPeek } from '@/apps/mail/composables/useThreadSwipe'
import { translate as __ } from '@/platform/translation'

defineProps<{ peek?: ThreadPeek }>()

// Fixed, so the lines don't shuffle on each render.
const lineWidths = ['90%', '75%', '82%', '60%', '88%', '45%']
</script>
