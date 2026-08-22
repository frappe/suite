<!--
  PROTOTYPE — remove. Mail screen: thread list plus a reading pane.

  The list is the master, the pane is the detail, and the List family owns the
  link between them through `v-model:active` — so the open row keeps its
  highlight while the pointer wanders, and keyboard nav in the pane moves the
  highlight with it.
-->
<template>
  <!-- The Screener replaces the whole area, not one pane: it asks about
       people, so a thread list beside it would be answering the wrong
       question. -->
  <MailScreener v-if="isScreener" />

  <div v-else class="flex min-h-0 flex-1">
    <!-- Thread list -->
    <div class="flex w-96 shrink-0 flex-col border-r border-outline-gray-1">
      <div
        class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-outline-gray-1 pl-4 pr-2"
      >
        <div class="flex min-w-0 items-baseline gap-2">
          <span class="truncate text-base font-medium text-ink-gray-9">{{ mailboxLabel }}</span>
          <span v-if="unreadCount" class="shrink-0 text-sm text-ink-gray-5">
            {{ unreadCount }} unread
          </span>
        </div>
        <div class="flex shrink-0 items-center gap-0.5">
          <Tooltip placement="bottom">
            <Button variant="ghost" icon="lucide-refresh-cw" aria-label="Refresh" />
            <template #content>Refresh</template>
          </Tooltip>
          <Dropdown :options="listOptions" align="end">
            <Button variant="ghost" icon="lucide-settings-2" aria-label="List settings" />
          </Dropdown>
        </div>
      </div>

      <div class="shrink-0 px-2 py-2">
        <TextInput v-model="search" placeholder="Search mail" aria-label="Search mail">
          <template #prefix>
            <span class="lucide-search size-4" aria-hidden="true" />
          </template>
        </TextInput>
      </div>

      <ScrollArea class="min-h-0 flex-1">
        <List v-model:active="activeId" class="px-2 pb-6">
          <ListRows :items="threads" row-key="id">
            <template #default="{ item: thread }">
              <ListRow :value="thread.id" @click="openThread(thread)">
                <!-- self-start pins the dot to the sender line. The h-4 box is
                     one text-base line box, so the dot centres on the name and
                     not on the middle of the three-line row. -->
                <ListCell class="self-start pt-2.5">
                  <span class="flex h-4 items-center">
                    <span
                      class="size-1.5 rounded-full"
                      :class="thread.unread ? 'bg-surface-blue-7' : 'bg-transparent'"
                    />
                  </span>
                </ListCell>

                <ListCell>
                  <span class="flex min-w-0 flex-col gap-0.5 py-2.5">
                    <span class="flex min-w-0 items-center gap-1.5">
                      <span
                        class="truncate text-base"
                        :class="
                          thread.unread ? 'font-medium text-ink-gray-9' : 'text-ink-gray-8'
                        "
                      >
                        {{ threadFrom(thread) }}
                      </span>
                      <span
                        v-if="thread.messages.length > 1"
                        class="shrink-0 text-xs text-ink-gray-5"
                      >
                        {{ thread.messages.length }}
                      </span>
                      <span
                        v-if="thread.starred"
                        class="lucide-star size-3.5 shrink-0 text-ink-amber-6"
                        aria-hidden="true"
                      />
                    </span>
                    <span
                      class="truncate text-p-sm"
                      :class="thread.unread ? 'font-medium text-ink-gray-8' : 'text-ink-gray-7'"
                    >
                      {{ thread.subject }}
                    </span>
                    <span class="flex min-w-0 items-center gap-1.5">
                      <span
                        v-if="hasAttachment(thread)"
                        class="lucide-paperclip size-3.5 shrink-0 text-ink-gray-5"
                        aria-hidden="true"
                      />
                      <span class="truncate text-p-sm text-ink-gray-5">
                        {{ threadSnippet(thread) }}
                      </span>
                    </span>
                  </span>
                </ListCell>

                <ListCell class="self-start pt-2.5">
                  <span class="flex h-4 items-center text-xs text-ink-gray-5">
                    {{ lastMessage(thread).time }}
                  </span>
                </ListCell>
              </ListRow>
            </template>
          </ListRows>
        </List>

        <div
          v-if="!threads.length"
          class="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center"
        >
          <span class="lucide-inbox size-7 text-ink-gray-4" aria-hidden="true" />
          <span class="text-base text-ink-gray-6">
            {{ search ? 'No threads match your search' : 'Nothing here' }}
          </span>
        </div>
      </ScrollArea>
    </div>

    <!-- Reading pane -->
    <MailThreadView
      v-if="activeThread"
      :key="activeThread.id"
      :thread="activeThread"
      :has-prev="activeIndex > 0"
      :has-next="activeIndex < threads.length - 1"
      @close="activeId = undefined"
      @prev="step(-1)"
      @next="step(1)"
      @toggle-read="activeThread.unread = !activeThread.unread"
    />
    <div v-else class="flex min-w-0 flex-1 flex-col items-center justify-center gap-2">
      <span class="lucide-mail size-8 text-ink-gray-4" aria-hidden="true" />
      <span class="text-base text-ink-gray-5">Select a thread to read it</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Dropdown, ScrollArea, TextInput, Tooltip } from 'frappe-ui'
import { List, ListCell, ListRow, ListRows } from 'frappe-ui/list'

import MailScreener from '../parts/MailScreener.vue'
import MailThreadView from '../parts/MailThreadView.vue'
import {
  MAIL_PLACES,
  lastMessage,
  threadFrom,
  threadSnippet,
  threadsIn,
  type MailThread,
} from '../mailFixtures'
import { useShellNav } from '../useShellNav'

const { sub } = useShellNav()

const isScreener = computed(() => sub.value === 'screener')

const mailbox = computed(() => MAIL_PLACES.find((m) => m.id === (sub.value || 'inbox')))
const mailboxLabel = computed(() => mailbox.value?.label ?? 'Inbox')

const search = ref('')
const unreadOnly = ref(false)
const sort = ref<'newest' | 'oldest'>('newest')

const threads = computed(() => {
  const query = search.value.trim().toLowerCase()
  let rows = threadsIn(mailbox.value?.id ?? 'inbox')
  if (unreadOnly.value) rows = rows.filter((thread) => thread.unread)
  if (query) {
    rows = rows.filter((thread) =>
      [thread.subject, threadFrom(thread), threadSnippet(thread)]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }
  return sort.value === 'oldest' ? [...rows].reverse() : rows
})

const unreadCount = computed(() => threads.value.filter((thread) => thread.unread).length)

const activeId = ref<string>()
const activeIndex = computed(() => threads.value.findIndex((t) => t.id === activeId.value))
const activeThread = computed(() => threads.value[activeIndex.value] ?? null)

// Switching mailbox or filtering the list can drop the open thread, so the pane
// closes rather than showing a row the list no longer has.
watch(threads, (rows) => {
  if (activeId.value && !rows.some((thread) => thread.id === activeId.value)) {
    activeId.value = undefined
  }
})

function openThread(thread: MailThread) {
  thread.unread = false
}

/** Newer / older in the pane header walks the list the user is looking at. */
function step(delta: number) {
  const next = threads.value[activeIndex.value + delta]
  if (!next) return
  next.unread = false
  activeId.value = next.id
}

function hasAttachment(thread: MailThread) {
  return thread.messages.some((message) => message.attachments?.length)
}

const listOptions = computed(() => [
  {
    group: 'Sort',
    options: [
      {
        label: 'Newest first',
        selected: sort.value === 'newest',
        onClick: () => (sort.value = 'newest'),
      },
      {
        label: 'Oldest first',
        selected: sort.value === 'oldest',
        onClick: () => (sort.value = 'oldest'),
      },
    ],
  },
  {
    group: 'Filter',
    options: [
      {
        label: 'Unread only',
        selected: unreadOnly.value,
        onClick: () => (unreadOnly.value = !unreadOnly.value),
      },
    ],
  },
  {
    group: 'Mailbox',
    options: [
      { label: 'Mark all as read', icon: 'lucide-mail-open', onClick: () => {} },
      { label: 'Empty mailbox', icon: 'lucide-trash-2', onClick: () => {} },
    ],
  },
])
</script>
