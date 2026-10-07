<template>
  <DashboardLayout
    area="mail"
    :breadcrumbs="[{ label: __('Domains') }]"
    :button-label="__('Add Domain')"
    :button-action="() => (showAddDomain = true)"
  >
    <div class="flex items-center justify-between gap-3">
      <FormControl v-model="search" :placeholder="__('Search')" class="w-80">
        <template #prefix>
          <FeatherIcon name="search" class="text-ink-gray-5 w-4" />
        </template>
      </FormControl>
      <div class="flex items-center gap-3">
        <FormControl
          v-model="status"
          :placeholder="__('Status')"
          class="w-40"
          type="select"
          :options="STATUS_OPTIONS"
        />
      </div>
    </div>
    <ListView
      v-if="list.status === 'success'"
      class="min-h-0 flex-1 !overflow-y-auto [&>div:first-child]:sticky [&>div:first-child]:top-0 [&>div:first-child]:z-10"
      :columns="LIST_COLUMNS"
      :rows="list.rows"
      :options="listOptions"
      row-key="id"
    >
      <ListHeader />
      <ListRows>
        <template v-if="list.rows.length">
          <ListRow
            v-for="row in list.rows"
            :key="row.id"
            v-slot="{ column, item }"
            :row="row"
            class="hover:!bg-surface-gray-1"
          >
            <ListRowItem :item="item">
              <Badge
                v-if="column.key === 'status'"
                :theme="domainStatusBadge(item).theme"
                :label="domainStatusBadge(item).label"
              />
              <span
                v-else-if="column.key === 'last_verified_at' || column.key === 'created_at'"
                class="text-ink-gray-5 text-sm"
              >
                {{ formatAgo(item) }}
              </span>
            </ListRowItem>
          </ListRow>
        </template>
        <ListEmptyState v-else />
      </ListRows>
    </ListView>
    <DashboardListSkeleton v-else />
    <DashboardPager
      v-if="list.status === 'success' && list.total"
      :count="list.rows.length"
      :total="list.total ?? 0"
      :page-length="pageLength"
      :has-more="list.hasNext"
      :loading="list.isFetching"
      @update:page-length="(value) => (pageLength = value)"
      @load-more="list.fetchNext().catch(() => {})"
    />
  </DashboardLayout>
  <AddDomainModal v-model="showAddDomain" @reload-domains="list.refetch().catch(() => {})" />
</template>
<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Badge, FormControl, usePageMeta } from 'frappe-ui'
import {
  Icon as FeatherIcon,
  ListEmptyState,
  ListHeader,
  ListRow,
  ListRowItem,
  ListRows,
  ListView,
} from 'frappe-ui/experimental'
import { computed, ref } from 'vue'

import { api, useInfiniteQuery } from '@/api'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'
import AddDomainModal from '@/apps/mail/components/Modals/AddDomainModal.vue'
import { useAddOnArrival } from '@/apps/mail/utils/addOnArrival'
import { fromNow } from '@/apps/mail/utils/datetime'
import {
  domainStatusBadge,
  domainStatusOptions,
  type DomainStatus,
} from '@/apps/mail/utils/domainStatus'
import { DEFAULT_PAGE_LENGTH, type PageLength } from '@/apps/mail/utils/paging'
import { DashboardLayout, DashboardListSkeleton } from '@/platform/dashboard'
import { appPageMeta } from '@/platform/page-meta'

usePageMeta(() => appPageMeta(__('Domains'), 'Mail'))
const showAddDomain = ref(false)
useAddOnArrival(showAddDomain)
const search = ref('')
const status = ref<'All' | DomainStatus>('All')
const debouncedSearch = refDebounced(search, 300)
const pageLength = ref<PageLength>(DEFAULT_PAGE_LENGTH)
const list = useInfiniteQuery(api.mail.admin.domains.list, () => ({
  txt: debouncedSearch.value,
  ...(status.value !== 'All'
    ? {
        status: status.value,
      }
    : {}),
  start: 0,
  page_length: pageLength.value,
}))
type DomainRow = {
  id: string
  name: string
  description?: string
  status: DomainStatus
  last_verified_at?: string
  created_at?: string
}
const LIST_COLUMNS = [
  {
    label: __('Domain'),
    key: 'name',
  },
  {
    label: __('Status'),
    key: 'status',
  },
  {
    label: __('Description'),
    key: 'description',
  },
  {
    label: __('Last Verified'),
    key: 'last_verified_at',
  },
  {
    label: __('Added'),
    key: 'created_at',
  },
]

// The empty state depends on why the list is empty: a filtered search that found
// nothing should not present the first-run "add your first domain" pitch.
const hasActiveFilters = computed(() => !!search.value || status.value !== 'All')
const listOptions = computed(() => ({
  selectable: false,
  showTooltip: false,
  emptyState: hasActiveFilters.value
    ? {
        title: __('No matching domains'),
        description: __('Try adjusting your search or filters.'),
      }
    : {
        title: __('No domains yet'),
        description: __('Add a domain to send and receive mail with your own addresses.'),
        button: {
          label: __('Add Domain'),
          variant: 'solid' as const,
          onClick: () => (showAddDomain.value = true),
        },
      },
  getRowRoute: (row: DomainRow) => ({
    name: 'mail-domain',
    params: {
      domainId: row.id,
    },
  }),
}))
const formatAgo = (value?: string) => fromNow(value) || '—'
const STATUS_OPTIONS = domainStatusOptions()
</script>
