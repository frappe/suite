<!-- The import and export jobs of one kind: mail, contacts or calendar. The three kinds share
     this page and differ only in the doctype they list and the words they use. -->
<template>
  <div class="flex h-screen flex-col text-ink-gray-8">
    <header class="flex items-center border-b px-5 py-2.5">
      <Breadcrumbs :items="[{ label: kindOf.listLabel() }]" />
    </header>
    <!-- The tab list carries no padding of its own: inset it to the header's,
		     and pad it evenly so the 28px triggers sit in a 40px band like the header
		     above. The underline indicator rides on the list's bottom border, so it
		     stays on the rail rather than tracking the label. -->
    <Tabs
      v-model="operation"
      :tabs="tabs"
      class="[&>[data-slot=tab-list]]:px-5 [&>[data-slot=tab-list]]:py-1.5"
      @update:model-value="$router.replace({ query: { operation } })"
    >
      <template #tab-panel>
        <div class="m-5 flex flex-1 flex-col space-y-5 overflow-y-auto">
          <FormControl
            v-model="status"
            :placeholder="__('Status')"
            type="select"
            :options="STATUS_OPTIONS"
            class="w-full sm:w-48"
          />
          <DashboardList
            :columns="columns"
            :rows="rows"
            row-key="name"
            :loading="exchanges.status === 'pending'"
            :skeleton-rows="6"
            :row-route="(row) => ({ name: kindOf.detailRoute, params: { id: row.name } })"
            :empty-state="exchanges.error ? undefined : { title: kindOf.emptyLabel() }"
          >
            <template #cell="{ column, item }">
              <Badge
                v-if="column.key === 'status'"
                :theme="getTheme(String(item))"
                :label="String(item)"
              />
              <span
                v-else
                class="truncate text-base"
                :class="column.key === 'started_at' ? 'text-ink-gray-8' : 'text-ink-gray-7'"
              >
                {{ item ?? '—' }}
              </span>
            </template>
          </DashboardList>
          <ErrorMessage v-if="exchanges.error" :message="exchanges.error?.message" />
        </div>
      </template>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { Badge, Breadcrumbs, ErrorMessage, FormControl, Tabs } from 'frappe-ui'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { api, useInfiniteQuery } from '@/api'
import { getTheme } from '@/apps/mail/utils'
import { formatSystemDateTime } from '@/apps/mail/utils/datetime'
import { EXCHANGE_KINDS, type ExchangeKind } from '@/apps/mail/utils/exchangeKinds'
import { DashboardList, type DashboardListColumn } from '@/platform/dashboard'

const { kind } = defineProps<{ kind: ExchangeKind }>()
const kindOf = computed(() => EXCHANGE_KINDS[kind])

const route = useRoute()

// The tab value is the operation itself, so it doubles as the query param.
const operation = ref<'Import' | 'Export'>(route.query.operation === 'Export' ? 'Export' : 'Import')
const isExport = computed(() => operation.value === 'Export')
const status = ref('All')

const STATUS_OPTIONS = [
  { label: __('All'), value: 'All' },
  { label: __('Draft'), value: 'Draft' },
  { label: __('Queued'), value: 'Queued' },
  { label: __('In Progress'), value: 'In Progress' },
  { label: __('Completed'), value: 'Completed' },
  { label: __('Failed'), value: 'Failed' },
  { label: __('Cancelled'), value: 'Cancelled' },
]

const exchanges = useInfiniteQuery(api.mail.exchanges.list, () => ({
  doctype: kindOf.value.doctype,
  operation: operation.value,
  status: status.value === 'All' ? undefined : status.value,
  start: 0,
  page_length: 100,
}))
const rows = computed(() =>
  exchanges.rows.map((row) => ({
    ...row,
    started_at: row.started_at ? formatSystemDateTime(row.started_at, 'MMM D, YYYY h:mm A') : '-',
  })),
)

const columns = computed(() => {
  const list: DashboardListColumn[] = [
    { label: __('Started'), key: 'started_at' },
    { label: __('Status'), key: 'status' },
    { label: __('Format'), key: isExport.value ? 'export_format' : 'import_format' },
  ]
  if (isExport.value) list.push({ label: __('Archive Type'), key: 'export_archive_type' })
  return list
})

// iconLeft, not icon: `icon` makes an icon-only trigger and drops the label.
const tabs = computed(() => [
  { value: 'Import', label: __('Import'), iconLeft: kindOf.value.icons.Import },
  { value: 'Export', label: __('Export'), iconLeft: kindOf.value.icons.Export },
])
</script>
