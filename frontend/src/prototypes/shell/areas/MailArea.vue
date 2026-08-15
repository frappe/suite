<!-- PROTOTYPE — remove. Fake Mail content: thread list + reading pane placeholder. -->
<template>
  <div class="flex min-h-0 flex-1">
    <!-- Thread list -->
    <div class="flex w-80 shrink-0 flex-col border-r border-outline-gray-1">
      <div class="flex h-12 shrink-0 items-center justify-between border-b border-outline-gray-1 px-4">
        <span class="text-base font-medium text-ink-gray-9">{{ mailboxLabel }}</span>
        <span v-if="mailbox?.unread" class="text-sm text-ink-gray-5">
          {{ mailbox.unread }} unread
        </span>
      </div>
      <ScrollArea class="min-h-0 flex-1">
        <List class="px-2 py-1">
          <ListRows :items="MAIL_THREADS" row-key="id">
            <template #default="{ item: thread }">
            <ListRow
              :value="thread.id"
              @click="activeThread = thread"
            >
              <ListCell>
                <span
                  class="size-1.5 rounded-full"
                  :class="thread.unread ? 'bg-surface-blue-5' : 'bg-transparent'"
                />
              </ListCell>
              <ListCell>
                <span class="flex min-w-0 flex-col gap-0.5 py-2">
                  <span
                    class="truncate text-base"
                    :class="thread.unread ? 'font-medium text-ink-gray-9' : 'text-ink-gray-8'"
                  >
                    {{ thread.from }}
                  </span>
                  <span class="truncate text-sm text-ink-gray-7">{{ thread.subject }}</span>
                  <span class="truncate text-sm text-ink-gray-5">{{ thread.snippet }}</span>
                </span>
              </ListCell>
              <ListCell>
                <span class="self-start pt-2 text-xs text-ink-gray-5">{{ thread.time }}</span>
              </ListCell>
            </ListRow>
            </template>
          </ListRows>
        </List>
      </ScrollArea>
    </div>

    <!-- Reading pane placeholder -->
    <div class="flex min-w-0 flex-1 flex-col">
      <template v-if="activeThread">
        <div class="flex h-12 shrink-0 items-center border-b border-outline-gray-1 px-5">
          <span class="truncate text-base font-medium text-ink-gray-9">
            {{ activeThread.subject }}
          </span>
        </div>
        <div class="flex flex-col gap-3 px-5 py-4">
          <div class="flex items-center gap-2">
            <Avatar size="md" :label="activeThread.from" />
            <div class="flex flex-col">
              <span class="text-base font-medium text-ink-gray-8">{{ activeThread.from }}</span>
              <span class="text-xs text-ink-gray-5">{{ activeThread.time }}</span>
            </div>
          </div>
          <p class="max-w-xl text-p-base text-ink-gray-7">
            {{ activeThread.snippet }} (Fake message body — the reading pane is a
            placeholder in this prototype.)
          </p>
        </div>
      </template>
      <div v-else class="flex flex-1 flex-col items-center justify-center gap-2">
        <span class="lucide-mail size-8 text-ink-gray-4" aria-hidden="true" />
        <span class="text-base text-ink-gray-5">Select a thread to read it</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Avatar, ScrollArea } from 'frappe-ui'
import { List, ListCell, ListRow, ListRows } from 'frappe-ui/list'

import { MAILBOXES, MAIL_THREADS, type MailThread } from '../fixtures'
import { useShellNav } from '../useShellNav'

const { sub } = useShellNav()

const mailbox = computed(() => MAILBOXES.find((m) => m.id === (sub.value || 'inbox')))
const mailboxLabel = computed(() => mailbox.value?.label ?? 'Inbox')

const activeThread = ref<MailThread | null>(null)
</script>
