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
          <span class="lucide-search size-4 text-ink-gray-5" aria-hidden="true" />
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
    <DashboardList
      :columns="LIST_COLUMNS"
      :rows="list.rows"
      row-key="id"
      :loading="list.status !== 'success'"
      :skeleton-rows="2"
      :row-route="listOptions.getRowRoute"
      :empty-state="listOptions.emptyState"
    >
      <template #cell="{ column, item }">
        <Badge
          v-if="column.key === 'status'"
          :theme="domainStatusBadge(item as DomainStatus).theme"
          :label="domainStatusBadge(item as DomainStatus).label"
        />
        <span
          v-else-if="column.key === 'last_verified_at' || column.key === 'created_at'"
          class="text-ink-gray-5 text-sm"
        >
          {{ formatAgo(item as string) }}
        </span>
        <span
          v-else
          class="truncate text-base"
          :class="column.key === LIST_COLUMNS[0].key ? 'text-ink-gray-8' : 'text-ink-gray-7'"
        >
          {{ item ?? '—' }}
        </span>
      </template>
    </DashboardList>
    <DashboardPager
      v-if="list.status === 'success' && list.total"
      :count="list.rows.length"
      :total="list.total ?? 0"
      :has-more="list.hasNext"
      :loading="list.isFetching"
      @load-more="list.fetchNext().catch(() => {})"
    />
  </DashboardLayout>
  <AddDomainModal v-model="showAddDomain" @reload-domains="list.refetch().catch(() => {})" />
</template>
<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Badge, FormControl, usePageMeta } from 'frappe-ui'
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
import { DEFAULT_PAGE_LENGTH } from '@/apps/mail/utils/paging'
import { DashboardLayout, DashboardList } from '@/platform/dashboard'
import { appPageMeta } from '@/platform/page-meta'

usePageMeta(() => appPageMeta(__('Domains'), 'Mail'))
const showAddDomain = ref(false)
useAddOnArrival(showAddDomain)
const search = ref('')
const status = ref<'All' | DomainStatus>('All')
const debouncedSearch = refDebounced(search, 300)
const list = useInfiniteQuery(api.mail.admin.domains.list, () => ({
  txt: debouncedSearch.value,
  ...(status.value !== 'All'
    ? {
        status: status.value,
      }
    : {}),
  start: 0,
  page_length: DEFAULT_PAGE_LENGTH,
}))
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
  getRowRoute: (row: { id: string }) => ({
    name: 'mail-domain',
    params: {
      domainId: row.id,
    },
  }),
}))
const formatAgo = (value?: string) => fromNow(value) || '—'
const STATUS_OPTIONS = domainStatusOptions()
</script>
