<template>
  <DashboardLayout
    area="mail"
    :breadcrumbs="[{ label: __('Groups') }]"
    :button-label="isFirstRun ? undefined : __('Add group')"
    :button-action="() => (showAddGroup = true)"
  >
    <div class="flex items-center space-x-3">
      <FormControl v-model="search" :placeholder="__('Search')" class="w-full sm:w-80">
        <template #prefix>
          <span class="lucide-search size-4 text-ink-gray-5" aria-hidden="true" />
        </template>
      </FormControl>
    </div>
    <DashboardList
      :failure="
        list.status === 'error'
          ? { title: __('Could not load groups'), retry: () => list.refetch() }
          : undefined
      "
      :columns="LIST_COLUMNS"
      :rows="list.rows"
      row-key="id"
      :loading="list.status === 'pending'"
      :skeleton-rows="2"
      :row-route="listOptions.getRowRoute"
      :empty-state="list.status === 'error' ? undefined : listOptions.emptyState"
    >
      <template #cell="{ column, row, item }">
        <span v-if="column.key === 'created_at'" class="truncate text-sm text-ink-gray-5">
          {{ formatCreatedAt(item as string | undefined) }}
        </span>
        <StorageBar v-else-if="column.key === 'quota_gb'" :used-bytes="row.used_bytes" />
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
      :has-more="list.hasNext"
      :loading="list.isFetching"
      @load-more="list.fetchNext().catch(() => {})"
    />
  </DashboardLayout>
  <AddGroupModal v-model="showAddGroup" @reload="list.refetch().catch(() => {})" />
</template>
<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { FormControl, usePageMeta } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useInfiniteQuery } from '@/api'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'
import AddGroupModal from '@/apps/mail/components/Modals/AddGroupModal.vue'
import StorageBar from '@/apps/mail/components/StorageBar.vue'
import { useAddOnArrival } from '@/apps/mail/utils/addOnArrival'
import { fromNow } from '@/apps/mail/utils/datetime'
import { DEFAULT_PAGE_LENGTH } from '@/apps/mail/utils/paging'
import { DashboardLayout, DashboardList } from '@/platform/dashboard'
import { appPageMeta } from '@/platform/page-meta'

usePageMeta(() => appPageMeta(__('Groups'), 'Mail'))
const showAddGroup = ref(false)
useAddOnArrival(showAddGroup)
const search = ref('')
const debouncedSearch = refDebounced(search, 300)
const list = useInfiniteQuery(api.mail.admin.groups.list, () => ({
  search: debouncedSearch.value,
  start: 0,
  page_length: DEFAULT_PAGE_LENGTH,
}))
const LIST_COLUMNS = [
  {
    label: __('Email address'),
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
    label: __('Added'),
    key: 'created_at',
  },
]
const hasActiveFilters = computed(() => !!search.value)
// With nothing added yet, the empty state's own Add button is the one call to action, under
// the line that explains it; the header's copy comes back with the first row.
const isFirstRun = computed(
  () => list.status === 'success' && !list.rows.length && !hasActiveFilters.value,
)
const listOptions = computed(() => ({
  selectable: false,
  showTooltip: false,
  emptyState: hasActiveFilters.value
    ? {
        title: __('No matching groups'),
        description: __('Try a different search.'),
      }
    : {
        title: __('No groups yet'),
        description: __('Create a group to give a team a shared address and mailbox.'),
        button: {
          label: __('Add group'),
          variant: 'solid' as const,
          onClick: () => (showAddGroup.value = true),
        },
      },
  getRowRoute: (row: { id: string }) => ({
    name: 'mail-group',
    params: {
      groupId: row.id,
    },
  }),
}))
const formatCreatedAt = (createdAt?: string) => fromNow(createdAt) || '—'
</script>
