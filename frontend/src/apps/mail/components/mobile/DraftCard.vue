<template>
  <!-- A reply saved in the thread, on a phone: laid out as an open message is, so it reads as one
       more of them. Who it is from, marked Draft in red, with More where an open message keeps its
       actions; who it goes to; when it was saved; then the first of what it says. A tap anywhere
       opens it on the compose page; More has Edit there too, and Discard, which takes it away, with
       Undo. -->
  <div
    role="button"
    tabindex="0"
    class="flex cursor-pointer flex-col"
    :aria-label="__('Edit draft')"
    @click="emit('open')"
    @keydown.enter.self="emit('open')"
  >
    <div class="flex items-start gap-3 pb-4">
      <Avatar :label="sender" :image="mail.user_image" size="2xl" />
      <div class="flex min-w-0 flex-1 flex-col text-sm">
        <!-- A 32px button on the 24px name line, overhanging it as an open message's do. -->
        <div class="-mr-2 flex h-6 items-center gap-2">
          <!-- Name and recipients in the thread's own ink, as a sent message's header has them. -->
          <span class="min-w-0 truncate text-[15px] !font-semibold">
            {{ sender }}
          </span>
          <DraftBadge class="shrink-0" />
          <!-- The stop is on the wrapper, which lets the tap reach the sheet's own trigger. -->
          <div class="ml-auto flex shrink-0" @click.stop>
            <AdaptiveDropdown :options align="end">
              <Button variant="ghost" class="touch-target !size-8" :aria-label="__('More')">
                <template #icon>
                  <Ellipsis class="text-ink-gray-5 icon !size-[18px]" />
                </template>
              </Button>
            </AdaptiveDropdown>
          </div>
        </div>
        <span v-if="to" class="h-4 truncate leading-4">{{ to }}</span>
        <div class="mt-1 flex h-5 items-center">
          <MailDate :datetime="mail.received_at" />
        </div>
      </div>
    </div>
    <p
      class="line-clamp-3 whitespace-pre-line text-base"
      :class="written ? 'text-ink-gray-8' : 'text-ink-gray-4'"
    >
      {{ written || __('Nothing written yet') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { Avatar, Button } from 'frappe-ui'
import { Ellipsis, SquarePen, Trash2 } from 'lucide-vue-next'
import { computed } from 'vue'

import DraftBadge from '@/apps/mail/components/DraftBadge.vue'
import MailDate from '@/apps/mail/components/MailDate.vue'
import type { Mail } from '@/apps/mail/types'
import { writtenText } from '@/apps/mail/utils/draftText'
import AdaptiveDropdown from '@/platform/feedback/AdaptiveDropdown.vue'
import { translate as __ } from '@/platform/translation'

const { mail, body, signature } = defineProps<{
  mail: Mail
  /** The draft's own text, without the mail it quotes. */
  body?: string
  /** Who it goes out as, by name. */
  sender: string
  /** "to Dana": nothing when it is not addressed yet. */
  to: string
  /** The sending identity's, which the card leaves out of what was written. */
  signature?: string
}>()
const emit = defineEmits<{ open: []; discard: [] }>()

const written = computed(() => writtenText(body, signature))
// Discard in red, as it throws the draft away. Two rows need no line between them.
const options = [
  { label: __('Edit draft'), icon: SquarePen, onClick: () => emit('open') },
  { label: __('Discard'), icon: Trash2, theme: 'red' as const, onClick: () => emit('discard') },
]
</script>
