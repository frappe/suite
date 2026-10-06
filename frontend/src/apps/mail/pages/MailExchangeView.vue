<template>
  <div v-if="mailExchange.data" class="flex h-screen flex-col">
    <header class="flex items-center justify-between border-b px-5 py-2.5">
      <Breadcrumbs :items="breadcrumbs" />
      <Dropdown
        v-if="user.data.is_system_manager"
        :options="dropdownOptions"
        :button="{ icon: 'lucide-more-horizontal' }"
      />
    </header>
    <div class="mx-auto my-5 rounded-4 border p-12 sm:w-[60rem]">
      <div class="flex items-center space-x-2">
        <h1 class="text-2xl !font-semibold">
          {{ __('Mail {0}', [__(mailExchange.data?.operation)]) }}
        </h1>
        <Badge :theme="getTheme(mailExchange.data?.status)" :label="mailExchange.data?.status" />
      </div>
      <p class="my-4 text-base">{{ operationDetails }}</p>
      <CopyCode
        v-if="mailExchange.data?.output"
        :code="mailExchange.data?.output"
        class="mt-8 max-h-80 overflow-y-auto"
      />
      <template v-if="attachment.data?.file_url">
        <hr class="my-8" />
        <a
          v-if="attachment.data?.file_url"
          class="flex cursor-pointer items-center space-x-2 text-base hover:underline"
          :href="attachment.data.file_url"
          target="_blank"
        >
          <Download class="text-ink-gray-4 h-4 w-4 shrink-0" />
          <span>
            {{
              __('{0} ({1})', [attachment.data?.file_name, formatBytes(attachment.data?.file_size)])
            }}
          </span>
        </a>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Badge, Breadcrumbs, Dropdown } from 'frappe-ui'
import { Download } from 'lucide-vue-next'
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, useQuery } from '@/api'
import CopyCode from '@/apps/mail/components/CopyCode.vue'
import { formatBytes, getTheme } from '@/apps/mail/utils'
import { formatSystemDateTime } from '@/apps/mail/utils/datetime'

const { id } = defineProps<{ id: string }>()

const router = useRouter()

const mailExchange = useQuery(api.mail.exchanges.get, () => ({
  doctype: 'Mail Exchange',
  name: id,
}))
watch(
  () => [mailExchange.status, mailExchange.data] as const,
  ([status, data]) => {
    if (status === 'error' || (status === 'success' && !data?.operation))
      router.replace('/mail/mail-exchanges')
  },
)

const operationDetails = computed(() => {
  const format =
    mailExchange.data?.operation === 'Import'
      ? mailExchange.data?.import_format
      : mailExchange.data?.export_format
  return `${(format ?? '').toUpperCase()} · ${formatSystemDateTime(mailExchange.data?.started_at, 'MMM D, YYYY [at] h:mm A')}`
})

const attachment = useQuery(api.mail.exchanges.attachment, () => ({
  doctype: 'Mail Exchange',
  name: id,
}))

const dropdownOptions = computed(() => [
  {
    label: __('View in Desk'),
    icon: 'lucide-external-link',
    onClick: () => window.open(`/app/mail-exchange/${id}`, '_blank')?.focus(),
  },
])

const breadcrumbs = computed(() => [
  {
    label: __('Mail Exchanges'),
    route: `/mail-exchanges?operation=${mailExchange.data?.operation}`,
  },
  { label: id },
])
</script>
