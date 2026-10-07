<template>
  <div class="flex h-screen flex-col">
    <header class="flex items-center border-b px-5 py-2.5">
      <Breadcrumbs :items="[{ label: __('Mail Exchanges') }]" />
    </header>
    <!-- The tab list carries no padding of its own: inset it to the header's,
		     and pad it evenly so the 28px triggers sit in a 40px band like the header
		     above. The underline indicator rides on the list's bottom border, so it
		     stays on the rail rather than tracking the label. -->
    <Tabs
      v-model="operation"
      :tabs="TABS"
      class="[&>[data-slot=tab-list]]:px-5 [&>[data-slot=tab-list]]:py-1.5"
      @update:model-value="$router.replace({ query: { operation } })"
    >
      <template #tab-panel>
        <div class="m-5 flex flex-1 flex-col space-y-5 overflow-y-auto">
          <div class="flex items-center space-x-3">
            <FormControl
              v-model="status"
              :label="__('Status')"
              type="select"
              :options="STATUS_OPTIONS"
              class="w-40"
            />
          </div>
          <ListView
            v-if="rows"
            :columns="listColumns"
            :rows="rows"
            :options="LIST_OPTIONS"
            row-key="name"
            class="flex-1"
          >
            <ListHeader />
            <ListRows>
              <template v-if="rows.length">
                <ListRow v-for="row in rows" :key="row.name" v-slot="{ item, column }" :row="row">
                  <ListRowItem :item="item">
                    <Badge v-if="column.key == 'status'" :theme="getTheme(item)" :label="item" />
                  </ListRowItem>
                </ListRow>
              </template>
              <ListEmptyState v-else />
            </ListRows>
          </ListView>
          <ErrorMessage v-if="mailExchanges.error" :message="mailExchanges.error?.message" />
        </div>
      </template>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { Badge, Breadcrumbs, ErrorMessage, FormControl, Tabs } from 'frappe-ui'
import {
  ListEmptyState,
  ListHeader,
  ListRow,
  ListRowItem,
  ListRows,
  ListView,
} from 'frappe-ui/experimental'
import { HardDriveDownload, HardDriveUpload } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { api, useInfiniteQuery } from '@/api'
import { getTheme } from '@/apps/mail/utils'
import { formatSystemDateTime } from '@/apps/mail/utils/datetime'

const route = useRoute()

// The tab value is the operation itself, so it doubles as the query param.
const operation = ref<'Import' | 'Export'>(route.query.operation === 'Export' ? 'Export' : 'Import')
const isExport = computed(() => operation.value === 'Export')
const status = ref(' ')

const STATUS_OPTIONS = [
  { label: '', value: ' ' },
  { label: __('Draft'), value: 'Draft' },
  { label: __('Queued'), value: 'Queued' },
  { label: __('In Progress'), value: 'In Progress' },
  { label: __('Completed'), value: 'Completed' },
  { label: __('Failed'), value: 'Failed' },
  { label: __('Cancelled'), value: 'Cancelled' },
]

const mailExchanges = useInfiniteQuery(api.mail.exchanges.list, () => ({
  doctype: 'Mail Exchange',
  operation: operation.value,
  status: status.value === ' ' ? undefined : status.value,
  start: 0,
  page_length: 100,
}))
const rows = computed(() =>
  mailExchanges.rows.map((row) => ({
    ...row,
    started_at: row.started_at ? formatSystemDateTime(row.started_at, 'MMM D, YYYY h:mm A') : '-',
  })),
)

const listColumns = computed(() => {
  const columns = [
    { label: __('Started'), key: 'started_at' },
    { label: __('Status'), key: 'status' },
    {
      label: __('Format'),
      key: isExport.value ? 'export_format' : 'import_format',
    },
  ]
  if (isExport.value) columns.push({ label: __('Archive Type'), key: 'export_archive_type' })
  return columns
})

const LIST_OPTIONS = {
  selectable: false,
  getRowRoute: (row) => ({ name: 'mail-exchange', params: { id: row.name } }),
  emptyState: { description: __('No mail exchanges found.') },
}

// iconLeft, not icon: `icon` makes an icon-only trigger and drops the label.
const TABS = [
  { value: 'Import', label: __('Import'), iconLeft: HardDriveDownload },
  { value: 'Export', label: __('Export'), iconLeft: HardDriveUpload },
]
</script>
