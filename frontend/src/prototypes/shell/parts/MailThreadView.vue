<!--
  PROTOTYPE — remove. The reading pane: one thread, its messages, and the
  actions that would act on it.

  Older messages collapse to a single line so a long thread still opens at the
  part you care about — the newest message. Every action is a no-op except the
  ones whose result is visible here: star, read/unread, and expanding a message.
-->
<template>
  <div class="flex min-w-0 flex-1 flex-col">
    <!-- Actions live in the header and the subject lives in the body, so the
         header keeps one fixed row of controls whatever the subject's length. -->
    <div
      class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-outline-gray-1 px-3"
    >
      <div class="flex items-center gap-0.5">
        <Tooltip v-for="action in primaryActions" :key="action.label" placement="bottom">
          <Button
            variant="ghost"
            :icon="action.icon"
            :aria-label="action.label"
            @click="action.onClick"
          />
          <template #content>{{ action.label }}</template>
        </Tooltip>

        <span class="mx-1 h-4 border-l border-outline-gray-2" aria-hidden="true" />

        <Dropdown :options="moveOptions" align="start">
          <Tooltip placement="bottom">
            <Button variant="ghost" icon="lucide-folder-input" aria-label="Move to" />
            <template #content>Move to</template>
          </Tooltip>
        </Dropdown>
        <Dropdown :options="labelOptions" align="start">
          <Tooltip placement="bottom">
            <Button variant="ghost" icon="lucide-tag" aria-label="Label" />
            <template #content>Label</template>
          </Tooltip>
        </Dropdown>
        <Dropdown :options="moreOptions" align="start">
          <Button variant="ghost" icon="lucide-ellipsis" aria-label="More actions" />
        </Dropdown>
      </div>

      <div class="flex items-center gap-0.5">
        <Tooltip placement="bottom">
          <Button
            variant="ghost"
            icon="lucide-chevron-up"
            aria-label="Newer thread"
            :disabled="!hasPrev"
            @click="emit('prev')"
          />
          <template #content>Newer</template>
        </Tooltip>
        <Tooltip placement="bottom">
          <Button
            variant="ghost"
            icon="lucide-chevron-down"
            aria-label="Older thread"
            :disabled="!hasNext"
            @click="emit('next')"
          />
          <template #content>Older</template>
        </Tooltip>
        <Tooltip placement="bottom">
          <Button variant="ghost" icon="lucide-x" aria-label="Close" @click="emit('close')" />
          <template #content>Close</template>
        </Tooltip>
      </div>
    </div>

    <ScrollArea class="min-h-0 flex-1" viewport-class="px-6 py-5">
      <div class="mx-auto flex max-w-3xl flex-col gap-4">
        <!-- Subject block -->
        <div class="flex items-start gap-3">
          <!-- The labels sit on the subject line: they qualify the subject, and
               a second row for them pushed the first message down. -->
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <h1 class="text-2xl font-semibold text-ink-gray-9">{{ thread.subject }}</h1>
            <Badge
              v-for="label in thread.labels"
              :key="label"
              :label="label"
              :theme="LABEL_THEME[label]"
              variant="subtle"
              size="sm"
            />
          </div>
          <Tooltip placement="bottom">
            <Button
              variant="ghost"
              :aria-label="starred ? 'Remove star' : 'Star'"
              @click="starred = !starred"
            >
              <span
                class="lucide-star size-4"
                :class="starred ? 'text-ink-amber-6' : 'text-ink-gray-5'"
                aria-hidden="true"
              />
            </Button>
            <template #content>{{ starred ? 'Remove star' : 'Star' }}</template>
          </Tooltip>
        </div>

        <!-- Messages: one timeline. Every message keeps the same 24px avatar
             in the same gutter, so the rule between them reads as one line
             down the thread and both states start on the same baseline. -->
        <div class="flex flex-col">
          <div
            v-for="(message, index) in thread.messages"
            :key="message.id"
            class="flex gap-3"
          >
            <div class="flex shrink-0 flex-col items-center pt-0.5">
              <Avatar size="md" :image="MAIL_AVATARS[message.from]" :label="message.from" />
              <!-- The connector is laid out, not positioned: it fills what is
                   left of the row, so it always meets the next avatar. -->
              <span
                v-if="index < thread.messages.length - 1"
                class="-mb-0.5 w-0 flex-1 border-l border-outline-gray-2"
                aria-hidden="true"
              />
            </div>

            <div class="flex min-w-0 flex-1 flex-col pb-4">
              <!-- Collapsed: one line, so a long thread opens at the newest message. -->
              <button
                v-if="!isOpen(message.id)"
                type="button"
                class="-mx-2 flex h-7 items-center gap-2 rounded-4 px-2 text-left hover:bg-surface-gray-1"
                @click="open.add(message.id)"
              >
                <span class="shrink-0 text-base font-medium text-ink-gray-8">
                  {{ message.from }}
                </span>
                <span class="truncate text-base text-ink-gray-5">{{ message.body[0] }}</span>
                <span
                  v-if="message.attachments?.length"
                  class="lucide-paperclip size-3.5 shrink-0 text-ink-gray-5"
                  aria-hidden="true"
                />
                <span class="ml-auto shrink-0 text-xs text-ink-gray-5">{{ message.time }}</span>
              </button>

              <!-- Expanded -->
              <article v-else>
                <header class="flex h-7 items-center gap-1.5">
                  <span class="truncate text-base font-medium text-ink-gray-9">
                    {{ message.from }}
                  </span>
                  <span class="truncate text-xs text-ink-gray-5">
                    &lt;{{ message.fromEmail }}&gt;
                  </span>
                  <div class="ml-auto flex shrink-0 items-center gap-0.5">
                    <span class="pr-1 text-xs text-ink-gray-5">{{ message.sentAt }}</span>
                    <Tooltip placement="bottom">
                      <Button variant="ghost" icon="lucide-reply" aria-label="Reply" />
                      <template #content>Reply</template>
                    </Tooltip>
                    <Dropdown :options="messageOptions" align="end">
                      <Button variant="ghost" icon="lucide-ellipsis" aria-label="Message actions" />
                    </Dropdown>
                    <Button
                      v-if="thread.messages.length > 1"
                      variant="ghost"
                      icon="lucide-chevron-up"
                      aria-label="Collapse message"
                      @click="open.delete(message.id)"
                    />
                  </div>
                </header>
                <span class="block truncate text-xs text-ink-gray-5">
                  to {{ message.to.join(', ') || 'no one yet' }}
                </span>

                <div class="mt-2.5 flex flex-col gap-2.5">
                  <p
                    v-for="(paragraph, i) in message.body"
                    :key="i"
                    class="whitespace-pre-line text-p-base text-ink-gray-8"
                  >
                    {{ paragraph }}
                  </p>
                </div>

                <!-- Attachments read as files, so they use the same chip shape the
                     Files area uses for a row: icon, name, size. -->
                <div v-if="message.attachments?.length" class="mt-4 flex flex-wrap gap-2">
                  <button
                    v-for="file in message.attachments"
                    :key="file.name"
                    type="button"
                    class="flex max-w-full items-center gap-2 rounded-4 border border-outline-gray-2 py-1.5 pl-2 pr-3 hover:bg-surface-gray-1"
                    @click="openAttachment(file.name)"
                  >
                    <span
                      :class="[file.icon, 'size-4 shrink-0 text-ink-gray-6']"
                      aria-hidden="true"
                    />
                    <span class="flex min-w-0 flex-col items-start">
                      <span class="truncate text-sm text-ink-gray-8">{{ file.name }}</span>
                      <span class="text-2xs text-ink-gray-5">{{ file.size }}</span>
                    </span>
                  </button>
                </div>

                <!-- Reply affordances sit on the last message, where the eye ends
                     up after reading the thread. -->
                <div
                  v-if="index === thread.messages.length - 1"
                  class="mt-4 flex items-center gap-2"
                >
                  <Button variant="subtle" label="Reply" icon-left="lucide-corner-up-left" />
                  <Button variant="ghost" label="Reply all" icon-left="lucide-reply-all" />
                  <Button variant="ghost" label="Forward" icon-left="lucide-forward" />
                </div>
              </article>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Avatar, Badge, Button, Dropdown, ScrollArea, Tooltip } from 'frappe-ui'

import { pdfRef } from '../fixtures'
import { MAILBOXES, MAIL_AVATARS, type MailLabel, type MailThread } from '../mailFixtures'
import { useShellNav } from '../useShellNav'

const props = defineProps<{
  thread: MailThread
  hasPrev: boolean
  hasNext: boolean
}>()

const emit = defineEmits<{
  close: []
  prev: []
  next: []
  'toggle-read': []
}>()

const LABEL_THEME: Record<MailLabel, 'blue' | 'green' | 'orange' | 'red' | 'gray'> = {
  Work: 'blue',
  Support: 'orange',
  Billing: 'green',
  Automated: 'gray',
  Personal: 'red',
}

const router = useRouter()
const { docTo } = useShellNav()

// A PDF attachment opens the shell's preview, the same page a PDF in Files
// opens. The other kinds have no viewer here, so they stay inert.
function openAttachment(name: string) {
  if (!/\.pdf$/i.test(name)) return
  router.push(docTo(pdfRef(name)))
}

const starred = ref(props.thread.starred)

// Only the newest message opens. Switching threads resets both, so the pane
// always lands on the same place in every thread.
const open = reactive(new Set<string>())

watch(
  () => props.thread,
  (thread) => {
    starred.value = thread.starred
    open.clear()
    open.add(thread.messages[thread.messages.length - 1].id)
  },
  { immediate: true },
)

function isOpen(id: string) {
  return open.has(id)
}

const primaryActions = computed(() => [
  { label: 'Archive', icon: 'lucide-archive', onClick: () => {} },
  { label: 'Move to trash', icon: 'lucide-trash-2', onClick: () => {} },
  {
    label: props.thread.unread ? 'Mark as read' : 'Mark as unread',
    icon: props.thread.unread ? 'lucide-mail-open' : 'lucide-mail',
    onClick: () => emit('toggle-read'),
  },
  { label: 'Snooze', icon: 'lucide-alarm-clock', onClick: () => {} },
  { label: 'Report spam', icon: 'lucide-shield-alert', onClick: () => {} },
])

const moveOptions = MAILBOXES.filter((box) => box.id !== 'starred').map((box) => ({
  label: box.label,
  icon: box.icon,
  onClick: () => {},
}))

const labelOptions = (['Work', 'Support', 'Billing', 'Automated', 'Personal'] as MailLabel[]).map(
  (label) => ({
    label,
    selected: props.thread.labels.includes(label),
    onClick: () => {},
  }),
)

const moreOptions = [
  {
    group: 'Thread',
    options: [
      { label: 'Print', icon: 'lucide-printer', onClick: () => {} },
      { label: 'Open in new window', icon: 'lucide-external-link', onClick: () => {} },
      { label: 'Add to tasks', icon: 'lucide-circle-check', onClick: () => {} },
    ],
  },
  {
    group: 'Sender',
    options: [
      { label: 'Mute thread', icon: 'lucide-bell-off', onClick: () => {} },
      { label: 'Block sender', icon: 'lucide-user-round-x', onClick: () => {} },
      { label: 'Filter messages like this', icon: 'lucide-list-filter', onClick: () => {} },
    ],
  },
]

const messageOptions = [
  { label: 'Reply', icon: 'lucide-corner-up-left', onClick: () => {} },
  { label: 'Reply all', icon: 'lucide-reply-all', onClick: () => {} },
  { label: 'Forward', icon: 'lucide-forward', onClick: () => {} },
  { label: 'Copy link', icon: 'lucide-link', onClick: () => {} },
  { label: 'Show original', icon: 'lucide-file-code', onClick: () => {} },
]
</script>
