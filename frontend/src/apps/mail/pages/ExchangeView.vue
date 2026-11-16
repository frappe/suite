<!-- One import or export job: mail, contacts or calendar. The three kinds share this page and
     differ only in the doctype they read and the list they belong to. -->
<template>
  <div class="flex h-screen flex-col text-ink-gray-8">
    <header class="flex items-center justify-between gap-2 border-b px-5 py-2.5">
      <Breadcrumbs class="min-w-0" :items="breadcrumbs" />
      <Dropdown
        v-if="user?.data?.is_system_manager"
        :options="dropdownOptions"
        :button="{ icon: 'lucide-more-horizontal', label: __('More actions') }"
      />
    </header>
    <div class="flex-1 overflow-y-auto px-4 py-5">
      <div class="mx-auto max-w-5xl rounded-4 border p-6 sm:p-12">
        <template v-if="exchange.data">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-lg !font-semibold">{{ kindOf.title(exchange.data.operation) }}</h1>
            <Badge :theme="getTheme(exchange.data.status)" :label="exchange.data.status" />
          </div>
          <p class="my-4 text-p-base">{{ operationDetails }}</p>
          <CopyCode
            v-if="exchange.data.output"
            :code="exchange.data.output"
            class="mt-8 max-h-80 overflow-y-auto"
          />
          <template v-if="attachment.data?.file_url">
            <hr class="my-8" />
            <a
              class="flex cursor-pointer items-start gap-2 text-base hover:underline"
              :href="attachment.data.file_url"
              target="_blank"
            >
              <!-- One text line tall, so a name that wraps keeps the icon on its first line. -->
              <span class="flex h-[1lh] shrink-0 items-center">
                <Download class="size-4 text-ink-gray-4" />
              </span>
              <span class="min-w-0 break-all">
                {{
                  __('{0} ({1})', [
                    attachment.data.file_name,
                    formatBytes(attachment.data.file_size),
                  ])
                }}
              </span>
            </a>
          </template>
        </template>
        <div v-else role="status" :aria-label="__('Loading')">
          <DashboardSkeletonText class="text-lg" width="12rem" />
          <DashboardSkeletonText class="my-4 text-p-base" width="16rem" />
          <Skeleton class="mt-8 h-24 w-full rounded-4" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Badge, Breadcrumbs, Dropdown, Skeleton } from 'frappe-ui'
import { Download } from 'lucide-vue-next'
import { computed, inject, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, useQuery } from '@/api'
import CopyCode from '@/apps/mail/components/CopyCode.vue'
import type { UserResource } from '@/apps/mail/types'
import { formatBytes, getTheme, raiseError } from '@/apps/mail/utils'
import { formatSystemDateTime } from '@/apps/mail/utils/datetime'
import { EXCHANGE_KINDS, type ExchangeKind } from '@/apps/mail/utils/exchangeKinds'
import { DashboardSkeletonText } from '@/platform/dashboard'

const { id, kind } = defineProps<{ id: string; kind: ExchangeKind }>()

const kindOf = computed(() => EXCHANGE_KINDS[kind])

const router = useRouter()
const user = inject<UserResource>('$user')

const exchange = useQuery(api.mail.exchanges.get, () => ({
  doctype: kindOf.value.doctype,
  name: id,
}))
watch(
  () => [exchange.status, exchange.data] as const,
  ([status, data]) => {
    if (status === 'error') raiseError(exchange.error)
    else if (status === 'success' && !data?.operation)
      raiseError(__('This exchange was not found.'))
    else return
    router.replace({ name: kindOf.value.listRoute })
  },
)

const operationDetails = computed(() => {
  const data = exchange.data
  const format = data?.operation === 'Import' ? data.import_format : data?.export_format
  return `${(format ?? '').toUpperCase()} · ${formatSystemDateTime(data?.started_at, 'MMM D, YYYY [at] h:mm A')}`
})

const attachment = useQuery(api.mail.exchanges.attachment, () => ({
  doctype: kindOf.value.doctype,
  name: id,
}))

const dropdownOptions = computed(() => [
  {
    label: __('View in Desk'),
    icon: 'lucide-external-link',
    onClick: () => window.open(`/app/${kindOf.value.deskPath}/${id}`, '_blank')?.focus(),
  },
])

const breadcrumbs = computed(() => {
  const operation = exchange.data?.operation
  return [
    {
      label: kindOf.value.listLabel(),
      route: { name: kindOf.value.listRoute, query: operation ? { operation } : {} },
    },
    { label: id },
  ]
})
</script>
