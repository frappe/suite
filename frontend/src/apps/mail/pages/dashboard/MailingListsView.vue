<template>
  <DashboardLayout
    area="mail"
    :breadcrumbs="[{ label: __('Mailing lists') }]"
    :button-label="isFirstRun ? undefined : __('Add mailing list')"
    :button-action="() => (showAdd = true)"
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
          ? { title: __('Could not load mailing lists'), retry: () => list.refetch() }
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
      <template #cell="{ column, item }">
        <span
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
  <AddMailingListModal v-model="showAdd" @reload="list.refetch().catch(() => {})" />
</template>
<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { FormControl, usePageMeta } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useInfiniteQuery } from '@/api'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'
import AddMailingListModal from '@/apps/mail/components/Modals/AddMailingListModal.vue'
import { useAddOnArrival } from '@/apps/mail/utils/addOnArrival'
import { DEFAULT_PAGE_LENGTH } from '@/apps/mail/utils/paging'
import { DashboardLayout, DashboardList } from '@/platform/dashboard'
import { appPageMeta } from '@/platform/page-meta'

usePageMeta(() => appPageMeta(__('Mailing lists'), 'Mail'))
const showAdd = ref(false)
useAddOnArrival(showAdd)
const search = ref('')
const debouncedSearch = refDebounced(search, 300)
const list = useInfiniteQuery(api.mail.admin.mailingLists.list, () => ({
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
    label: __('Recipients'),
    key: 'recipient_count',
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
        title: __('No matching mailing lists'),
        description: __('Try adjusting your search or filters.'),
      }
    : {
        title: __('No mailing lists yet'),
        description: __('Create a mailing list to broadcast mail to many recipients at once.'),
        button: {
          label: __('Add mailing list'),
          variant: 'solid' as const,
          onClick: () => (showAdd.value = true),
        },
      },
  getRowRoute: (row: { id: string }) => ({
    name: 'mail-mailing-list',
    params: {
      listId: row.id,
    },
  }),
}))
</script>
