<script setup lang="ts">
import { Avatar } from 'frappe-ui'

import type { WriterUser } from '@/apps/writer/drive'
import { translate as __ } from '@/platform/translation'

/** One person in an `@` list: avatar, name, email, and whether they can open the document. */
defineProps<{ person: WriterUser }>()
</script>

<template>
  <Avatar size="md" :image="person.user_image ?? undefined" :label="person.label" />
  <span class="flex min-w-0 flex-1 flex-col">
    <span class="truncate text-ink-gray-8">{{ person.label }}</span>
    <span v-if="person.email !== person.label" class="truncate text-xs text-ink-gray-5">
      {{ person.email }}
    </span>
  </span>
  <span v-if="person.has_access === false" class="shrink-0 text-xs text-ink-gray-5">
    {{ __('No access') }}
  </span>
</template>
