<template>
  <span class="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
    <span class="flex min-w-0 items-center gap-3">
      <span class="flex min-w-0 flex-1 items-center gap-1.5">
        <span class="truncate text-base-semibold text-ink-gray-8">
          {{ result.subject || "[No subject]" }}
        </span>
        <span
          v-if="attachmentCount"
          class="flex shrink-0 items-center gap-1 text-xs text-ink-gray-5"
        >
          <span class="lucide-paperclip size-3.5" aria-hidden="true" />
          {{ attachmentCount }}
        </span>
      </span>
      <span v-if="result.received_at" class="shrink-0 text-xs text-ink-gray-5">
        {{ getFormattedDate(result.received_at) }}
      </span>
    </span>
    <span class="flex min-w-0 items-center gap-3">
      <span class="min-w-0 flex-1 truncate text-sm text-ink-gray-6">{{
        interlocutors
      }}</span>
      <span class="flex shrink-0 items-center gap-1.5">
        <span
          v-for="mailbox in result.mailboxes"
          :key="mailbox.mailbox_id"
          class="shrink-0 rounded-4 bg-surface-gray-2 px-1.5 py-0.5 text-xs text-ink-gray-6 group-data-[state=active]:bg-surface-elevation-1"
        >
          {{ mailbox.mailbox_name }}
        </span>
      </span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { getFormattedDate } from "@/apps/mail/utils";

import type { MailSearchResult } from "./types";

const props = defineProps<{ result: MailSearchResult }>();

const interlocutors = computed(() => {
  const sender = props.result.from_name || props.result.from_email;
  const seen = new Set<string>();
  const recipients = (props.result.recipients ?? [])
    .filter(
      (recipient) =>
        recipient.email !== props.result.from_email &&
        !seen.has(recipient.email) &&
        seen.add(recipient.email),
    )
    .map((recipient) => recipient.display_name || recipient.email)
    .join(", ");

  return recipients ? `${sender}, ${recipients}` : sender;
});

const attachmentCount = computed(
  () =>
    (props.result.attachments ?? []).filter(
      (attachment) =>
        attachment.filename && attachment.disposition === "attachment",
    ).length,
);
</script>
