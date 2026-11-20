<template>
  <!-- A thread before its messages arrive, in the shape an open one takes (see MailThread): the
       subject, then one message with its sender row and a few lines of body. The paddings and the
       line boxes are the thread's own, so the subject and the sender land where their outlines
       stood. -->
  <div class="min-h-full animate-pulse" role="status" :aria-label="__('Loading thread')">
    <div class="sm:px-5 sm:pt-5">
      <!-- Subject: the heading's one line. -->
      <div class="flex h-7 items-center box-content max-sm:px-4 max-sm:pb-2 max-sm:pt-4 sm:pb-2">
        <div class="bg-surface-gray-3 h-4 w-3/5 rounded-4" />
      </div>

      <!-- One message, bare as a lone one stands (see MailThread): on a phone, on the subject's
           axis, without a card. -->
      <div class="max-sm:mt-2 max-sm:px-4 max-sm:pb-4 max-sm:pt-1 sm:mt-2">
        <!-- Sender: avatar, then the name (and on a desktop the address) over the recipients, over
             the date, in the open message's 24, 16 and 20px rows. -->
        <div class="flex items-start space-x-3 pb-6 max-sm:pb-4">
          <div class="bg-surface-gray-3 h-10 w-10 shrink-0 rounded-full" />
          <div class="min-w-0 flex-1">
            <div class="flex h-6 items-center space-x-1.5">
              <div class="bg-surface-gray-3 h-3.5 w-28 rounded-4" />
              <div class="bg-surface-gray-3 h-3 w-44 rounded-4 max-sm:hidden" />
            </div>
            <div class="flex h-4 items-center">
              <div class="bg-surface-gray-3 h-3 w-36 rounded-4" />
            </div>
            <div class="mt-1 flex h-5 items-center">
              <div class="bg-surface-gray-3 h-3 w-16 rounded-4" />
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
// Fixed, so the lines don't shuffle on each render.
const lineWidths = ['90%', '75%', '82%', '60%', '88%', '45%']
</script>
