<template>
  <DashboardLayout
    area="mail"
    :breadcrumbs="[{ label: __('Groups') }]"
    :button-label="__('Add Group')"
    :button-action="() => (showAddGroup = true)"
  >
    <div class="flex items-center space-x-3">
      <FormControl v-model="search" :placeholder="__('Search')" class="w-80">
        <template #prefix>
          <FeatherIcon name="search" class="text-ink-gray-5 w-4" />
        </template>
      </FormControl>
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
              <span v-if="column.key === 'created_at'">{{ formatCreatedAt(item) }}</span>
              <StorageBar
                v-else-if="column.key === 'quota_gb'"
                :used-bytes="row.used_bytes"
                :quota-gb="row.quota_gb"
              />
            </ListRowItem>
          </ListRow>
        </template>
        <ListEmptyState v-else />
      </ListRows>
    </ListView>
    <DashboardListSkeleton v-else :columns="4" />
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
  <AddGroupModal v-model="showAddGroup" @reload="list.refetch().catch(() => {})" />
</template>
<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { FormControl, usePageMeta } from 'frappe-ui'
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
import AddGroupModal from '@/apps/mail/components/Modals/AddGroupModal.vue'
import StorageBar from '@/apps/mail/components/StorageBar.vue'
import { useAddOnArrival } from '@/apps/mail/utils/addOnArrival'
import { fromNow } from '@/apps/mail/utils/datetime'
import { DEFAULT_PAGE_LENGTH, type PageLength } from '@/apps/mail/utils/paging'
import { DashboardLayout, DashboardListSkeleton } from '@/platform/dashboard'
import { appPageMeta } from '@/platform/page-meta'

usePageMeta(() => appPageMeta(__('Groups'), 'Mail'))
const showAddGroup = ref(false)
useAddOnArrival(showAddGroup)
const search = ref('')
const debouncedSearch = refDebounced(search, 300)
const pageLength = ref<PageLength>(DEFAULT_PAGE_LENGTH)
const list = useInfiniteQuery(api.mail.admin.groups.list, () => ({
  search: debouncedSearch.value,
  start: 0,
  page_length: pageLength.value,
}))
type GroupRow = {
  id: string
  name: string
  email?: string
  description?: string
  quota_gb?: number | null
  used_bytes?: number | null
  created_at?: string
}
const LIST_COLUMNS = [
  {
    label: __('Email'),
    key: 'email',
  },
  {
    label: __('Description'),
    key: 'description',
  },
  {
    label: __('Storage'),
    key: 'quota_gb',
  },
  {
    label: __('Created At'),
    key: 'created_at',
  },
]
const hasActiveFilters = computed(() => !!search.value)
const listOptions = computed(() => ({
  selectable: false,
  showTooltip: false,
  emptyState: hasActiveFilters.value
    ? {
        title: __('No matching groups'),
        description: __('Try adjusting your search or filters.'),
      }
    : {
        title: __('No groups yet'),
        description: __('Create a group to give a team a shared address and mailbox.'),
        button: {
          label: __('Add Group'),
          variant: 'solid' as const,
          onClick: () => (showAddGroup.value = true),
        },
      },
  getRowRoute: (row: GroupRow) => ({
    name: 'mail-group',
    params: {
      groupId: row.id,
    },
  }),
}))
const formatCreatedAt = (createdAt?: string) => fromNow(createdAt) || '—'
</script>
