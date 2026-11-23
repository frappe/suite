<template>
  <div class="text-ink-gray-6 mb-3 rounded-4 border p-2.5 px-4">
    <div class="flex items-start gap-3">
      <CircleAlert class="text-ink-red-4 mt-0.5 h-4.5 w-4.5 shrink-0 stroke-1.5" />
      <div class="min-w-0 flex-1">
        <span class="text-ink-gray-8 block font-medium">{{ __('Message not delivered') }}</span>
        <div v-for="recipient in failed" :key="recipient.email" class="mt-1.5">
          <p>{{ __("This message couldn't be delivered to {0}.", [recipient.email]) }}</p>
          <pre
            v-if="recipient.reason"
            class="bg-surface-gray-1 text-ink-gray-7 mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-4 p-2 font-mono text-xs"
            >{{ recipient.reason }}</pre>
        </div>
        <div class="-ml-2 mt-2">
          <Button
            variant="ghost"
            :label="__('Delivery details')"
            @click="
              router.push({
                name: 'mail-submission',
                params: { accountId: account, submissionId: submission.id },
              })
            "
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { CircleAlert } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import type { Submission } from '@/apps/mail/utils/submission'

// A sent message whose submission failed. Stalwart never updates a submission's delivery status,
// so this is mostly the bounce the server mailed back, read by the Outbox (see suite.mail.bounces).
const { submission, account } = defineProps<{ submission: Submission; account: string }>()

const router = useRouter()

const failed = computed(() => submission.recipients_status.filter((r) => r.status === 'failed'))
</script>
