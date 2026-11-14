<template>
  <div class="sm:bg-surface-gray-1 min-h-screen py-4 sm:py-12">
    <div
      class="bg-surface-base mx-auto max-w-full space-y-6 rounded-4 border p-4 sm:w-[75rem] sm:space-y-8 sm:p-12"
    >
      <template v-if="mime.data">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 class="text-lg !font-medium">{{ __('MIME Message') }}</h1>
          <Button
            :label="__('Copy to clipboard')"
            size="md"
            @click="copyToClipBoard(mime.data.message)"
          />
        </div>
        <div class="rounded-4 border">
          <div class="border-b px-4 py-4 sm:px-6">
            <h2>{{ __('Message Information') }}</h2>
          </div>
          <div
            v-for="[key, value] of fields"
            :key="key"
            class="even:bg-surface-gray-1 flex flex-col gap-1 px-4 py-4 text-base last:rounded-b-4 sm:flex-row sm:items-center sm:px-6"
          >
            <div class="text-ink-gray-5 w-full sm:w-1/4">{{ value.label }}</div>
            <div class="flex w-full items-center break-words sm:w-3/4">
              <Tooltip v-if="value.description" :text="value.description">
                <span>{{ value.value }}</span>
              </Tooltip>
              <template v-else>{{ value.value }}</template>
            </div>
          </div>
        </div>
        <pre class="overflow-x-auto whitespace-pre-wrap break-words" style="font-size: 0.875rem">{{
          mime.data.message
        }}</pre>
      </template>

      <div v-else-if="mime.error" class="space-y-4 text-center">
        <h1 class="text-2xl !font-medium text-ink-red-4">{{ __('Error') }}</h1>
        <p class="text-p-base text-ink-gray-5">
          {{ mime.error.message || __('This message could not be loaded.') }}
        </p>
        <Button
          :label="__('Return to Home')"
          size="md"
          @click="$router.push({ name: 'mail-root-shortcut' })"
        />
      </div>

      <div v-else class="flex justify-center py-10" role="status" :aria-label="__('Loading')">
        <LoaderCircle class="h-5 w-5 animate-spin text-ink-gray-5" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Button, Tooltip } from 'frappe-ui'
import { LoaderCircle } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { api, useQuery } from '@/api'
import { copyToClipBoard } from '@/apps/mail/utils'

const route = useRoute()
const mime = useQuery(api.mail.messages.mime, () => ({
  name: String(route.params.id),
}))
// The labelled facts about the message; its source shows below them, not as a row.
const fields = computed(() => {
  if (!mime.data) return []
  const { message: _source, ...facts } = mime.data
  return Object.entries(facts)
})
</script>
