<template>
  <!-- Who sent a message, and what the reader can do about them: write to them, keep their
	     address, or go back over the mail between them. Opened from the sender in an open message. -->
  <div class="w-72" @click.stop>
    <div class="flex items-center gap-2.5 p-3 pb-2.5">
      <Avatar :label="initial" :image="image" size="2xl" />
      <div class="min-w-0">
        <p class="text-ink-gray-8 truncate text-base font-semibold">{{ name }}</p>
        <!-- Copying belongs to the address, so it sits on it rather than among the actions. -->
        <div class="flex min-w-0 items-center gap-0.5">
          <p class="text-ink-gray-5 truncate text-sm">{{ email }}</p>
          <Tooltip :text="__('Copy address')">
            <button
              type="button"
              class="text-ink-gray-5 hover:text-ink-gray-8 flex shrink-0 p-0.5"
              :aria-label="__('Copy address')"
              @click="emit('copy')"
            >
              <span class="lucide-copy size-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
    <!-- Writing to them is what the card is mostly opened for: the one action at full width. -->
    <div class="px-3 pb-3">
      <Button variant="subtle" :label="__('Email')" class="w-full" @click="emit('email')" />
    </div>
    <!-- The last few other conversations with them, from them or to them: what came before is
	     usually the context for what they are saying now. It comes in under the card a moment after
	     it opens — too quickly to read as loading — and an address with none gets no section. -->
    <div v-if="recent.length" class="border-outline-gray-1 border-t p-1.5">
      <!-- View all ends the list it heads: every conversation with them, from or to, on the
	       search page. -->
      <div class="flex items-center justify-between px-1.5 pb-1 pt-0.5">
        <p class="text-ink-gray-5 text-xs">{{ __('Recent') }}</p>
        <button
          type="button"
          class="text-ink-gray-5 hover:text-ink-gray-8 text-xs"
          @click="emit('viewAll')"
        >
          {{ __('View all') }}
        </button>
      </div>
      <button
        v-for="row in recent"
        :key="row.thread_id"
        type="button"
        class="hover:bg-surface-gray-2 flex h-7 w-full items-center gap-3 rounded-4 px-1.5 text-left"
        @click="openThread(row)"
      >
        <span class="text-ink-gray-8 min-w-0 flex-1 truncate text-sm">
          {{ row.subject || __('[No subject]') }}
        </span>
        <MailDate :datetime="row.received_at" format="list" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Avatar, Button, Tooltip } from 'frappe-ui'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { api, useQuery, type OutputOf } from '@/api'
import MailDate from '@/apps/mail/components/MailDate.vue'
import { injectAccountScope } from '@/apps/mail/utils/accountScope'
import { homeMailbox } from '@/apps/mail/utils/recentWith'
import { mailboxParam } from '@/apps/mail/utils/unifiedFolders'

type RecentRow = OutputOf<typeof api.mail.messages.recentWith>[number]

const { email, threadId } = defineProps<{
  name: string
  email: string
  image?: string
  initial?: string
  // The conversation the card was opened from, left out of Recent.
  threadId?: string
}>()
const emit = defineEmits<{ email: []; copy: []; viewAll: []; open: [] }>()

const router = useRouter()
const { accountId, mailboxes, mailboxIds } = injectAccountScope()

// One more than shown, so the conversation the card was opened from can drop out and leave three.
const recentWith = useQuery(api.mail.messages.recentWith, () =>
  accountId.value && email ? { account: accountId.value, email, limit: 4 } : false,
)
const recent = computed(() =>
  (recentWith.data ?? []).filter((row) => row.thread_id !== threadId).slice(0, 3),
)

const openThread = (row: RecentRow) => {
  const ids = mailboxIds.value
  const mailbox = homeMailbox(row, [ids.inbox, ids.archive, ids.sent])
  if (!mailbox) return
  emit('open')
  router.push({
    name: 'mail-mail',
    params: {
      accountId: accountId.value,
      mailbox: mailboxParam(mailbox, mailboxes.value.data),
      threadID: row.thread_id,
    },
  })
}
</script>
