<template>
  <div class="sm:bg-surface-gray-1 min-h-screen py-4 sm:py-12">
    <div
      v-if="mime.data"
      class="bg-surface-base mx-auto max-w-full space-y-6 rounded-4 border p-4 sm:w-[75rem] sm:space-y-8 sm:p-12"
    >
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
          <!-- A block, not a flex row: a flex item will not shrink below its longest word, and a
               message ID or an address is one long word. -->
          <div class="w-full break-words sm:w-3/4">
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
    </div>

    <!-- Nothing to frame yet: what went wrong, or the spinner, sits alone on the page. -->
    <div v-else class="flex min-h-[60vh] items-center justify-center">
      <LoadError
        v-if="mime.error"
        v-bind="failure"
        :error="mime.error"
        :retrying="mime.isFetching"
        @retry="mime.refetch()"
      >
        <Button :label="__('Go to Mail')" @click="$router.push({ name: 'mail-root-shortcut' })" />
      </LoadError>
      <div v-else role="status" :aria-label="__('Loading')">
        <LoaderCircle class="size-5 animate-spin text-ink-gray-5" />
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
import LoadError from '@/apps/mail/components/LoadError.vue'
import { copyToClipBoard } from '@/apps/mail/utils'
import { TransportError } from '@/platform/transport'

const route = useRoute()
const mime = useQuery(api.mail.messages.mime, () => ({
  name: String(route.params.id),
}))
// The labelled facts about the message; its source shows below them, not as a row. A fact the
// message does not have (no CC, say) is left out rather than shown as an empty row.
const fields = computed(() => {
  if (!mime.data) return []
  const { message: _source, ...facts } = mime.data
  return Object.entries(facts).filter(([, fact]) => fact?.value?.trim())
})
// The server's own words for a missing or forbidden message are a status line ("NOT FOUND"):
// say what it means instead. Anything else keeps the server's message under a plain title.
const failure = computed(() => {
  const status = mime.error instanceof TransportError ? mime.error.status : 0
  if (status === 404)
    return {
      title: __('This message could not be found.'),
      description: __('It may have been deleted, or the link may be wrong.'),
    }
  if (status === 403) return { title: __('You do not have access to this message.') }
  return { title: __('Could not load this message.') }
})
</script>
