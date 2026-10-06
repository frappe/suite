<template>
  <div class="flex items-center justify-between gap-3">
    <FormControl v-model="search" :placeholder="__('Search')" class="w-80">
      <template #prefix>
        <FeatherIcon name="search" class="text-ink-gray-5 w-4" />
      </template>
    </FormControl>
    <div class="flex items-center gap-3">
      <FormControl
        v-model="status"
        :placeholder="__('Invitation Status')"
        class="w-40"
        type="select"
        :options="STATUS_OPTIONS"
      />
    </div>
  </div>

  <ListView
    v-if="list.status === 'success'"
    ref="listView"
    class="min-h-0 flex-1 !overflow-y-auto [&>div:first-child]:sticky [&>div:first-child]:top-0 [&>div:first-child]:z-10"
    :columns="LIST_COLUMNS"
    :rows="inviteRows"
    :options="listOptions"
    row-key="name"
  >
    <ListHeader />
    <ListRows>
      <template v-if="inviteRows.length">
        <ListRow
          v-for="row in inviteRows"
          :key="row.name"
          v-slot="{ column, item }"
          :row="row"
          class="hover:!bg-surface-gray-1"
        >
          <ListRowItem :item="item">
            <template v-if="column.key === 'role'">
              <Badge
                :label="row.is_admin ? __('Admin') : __('User')"
                :theme="row.is_admin ? 'amber' : 'blue'"
              />
            </template>
            <Badge
              v-else-if="column.key === 'status'"
              :label="item"
              :theme="getTheme(item as InviteStatusLabel)"
            />
          </ListRowItem>
        </ListRow>
      </template>
      <ListEmptyState v-else />
    </ListRows>
    <ListSelectBanner>
      <template #actions>
        <Button
          variant="ghost"
          theme="red"
          :label="__('Delete')"
          @click="showDeleteInvites = true"
        />
      </template>
    </ListSelectBanner>
  </ListView>
  <DashboardListSkeleton v-else :columns="5" />
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

  <EditInviteModal
    v-if="selectedInvite"
    v-model="showEditInvite"
    :invite-i-d="selectedInvite"
    @reload-invites="list.refetch().catch(() => {})"
  />
  <Dialog v-model:open="showDeleteInvites" v-bind="DELETE_INVITES_OPTIONS" />
</template>

<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Badge, Button, Dialog, FormControl } from 'frappe-ui'
import {
  Icon as FeatherIcon,
  ListEmptyState,
  ListHeader,
  ListRow,
  ListRowItem,
  ListRows,
  ListSelectBanner,
  ListView,
} from 'frappe-ui/experimental'
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useRoute } from 'vue-router'

import { api, useInfiniteQuery, useMutation, type InputOf } from '@/api'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'
import EditInviteModal from '@/apps/mail/components/Modals/EditInviteModal.vue'
import { raiseToast } from '@/apps/mail/utils'
import { DEFAULT_PAGE_LENGTH, type PageLength } from '@/apps/mail/utils/paging'
import DashboardListSkeleton from '@/components/dashboard/DashboardListSkeleton.vue'

type InviteStatus = 'All' | 'Pending' | 'Accepted' | 'Expired'
type InviteStatusLabel = Exclude<InviteStatus, 'All'>
type InviteRow = {
  name: string
  account: string
  is_admin: boolean
  backup_email: string | null
  invited_by: string
  is_verified: number | boolean
  status: InviteStatusLabel
}
const search = ref('')
// The overview links here with ?status=Expired; the filter follows the query on arrival.
const route = useRoute()
const STATUSES: InviteStatus[] = ['All', 'Pending', 'Accepted', 'Expired']
const statusFromQuery = (): InviteStatus =>
  STATUSES.find((value) => value === route.query.status) || 'All'
const status = ref<InviteStatus>(statusFromQuery())
watch(
  () => route.query.status,
  () => (status.value = statusFromQuery()),
)
const selectedInvite = ref('')
const showEditInvite = ref(false)
const showDeleteInvites = ref(false)
const debouncedSearch = refDebounced(search, 300)
const pageLength = ref<PageLength>(DEFAULT_PAGE_LENGTH)
const list = useInfiniteQuery(api.mail.admin.invites.list, () => ({
  search: debouncedSearch.value,
  ...(status.value !== 'All'
    ? {
        status: status.value,
      }
    : {}),
  start: 0,
  page_length: pageLength.value,
}))
const inviteRows = computed<InviteRow[]>(() =>
  list.rows.map((row) => ({
    ...row,
    is_admin: Boolean(row.is_admin),
    status: row.status,
  })),
)
const listView = useTemplateRef<{
  selections?: Set<string>
  toggleAllRows?: () => void
}>('listView')

// Names no longer listed leave the selection, as on the accounts list.
watch(
  () => list.rows,
  (rows) => {
    const selections = listView.value?.selections
    if (!selections?.size) return
    const shown = new Set(rows.map((row) => row.name))
    for (const name of Array.from(selections)) {
      if (!shown.has(name)) selections.delete(name)
    }
  },
)
const reloadInvites = () => list.refetch().catch(() => {})
defineExpose({
  reloadInvites,
})
const deleteInvites = useMutation(api.mail.admin.members.deleteAccountRequests)
async function deleteInvitesSubmit() {
  const input: InputOf<typeof api.mail.admin.members.deleteAccountRequests> = {
    names: Array.from(listView.value?.selections || []),
  }
  await deleteInvites.run(input)
  showDeleteInvites.value = false
  raiseToast(__('Invites deleted.'))
  listView.value?.toggleAllRows?.()
}
const DELETE_INVITES_OPTIONS = {
  title: __('Delete Invites'),
  message: __(
    'Are you sure you want to delete the selected invites? This will invalidate them for the recipients if pending.',
  ),
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      theme: 'red' as const,
      onClick: deleteInvitesSubmit,
    },
  ],
}
const LIST_COLUMNS = [
  {
    label: __('Assigned Email'),
    key: 'account',
  },
  {
    label: __('Role'),
    key: 'role',
  },
  {
    label: __('Backup Email'),
    key: 'backup_email',
  },
  {
    label: __('Invited By'),
    key: 'invited_by',
  },
  {
    label: __('Invitation Status'),
    key: 'status',
  },
]
const hasActiveFilters = computed(() => !!search.value || status.value !== 'All')
const listOptions = computed(() => ({
  showTooltip: false,
  rowHeight: 50,
  emptyState: hasActiveFilters.value
    ? {
        title: __('No matching invites'),
        description: __('Try adjusting your search or filters.'),
      }
    : {
        title: __('No pending invites'),
        description: __(
          'Invitations you send and self-signup requests will appear here until they are accepted.',
        ),
      },
  onRowClick: (row: InviteRow) => {
    selectedInvite.value = row.name
    showEditInvite.value = true
  },
}))
const STATUS_OPTIONS = [
  {
    label: __('All'),
    value: 'All',
  },
  {
    label: __('Pending'),
    value: 'Pending',
  },
  {
    label: __('Accepted'),
    value: 'Accepted',
  },
  {
    label: __('Expired'),
    value: 'Expired',
  },
]
const getTheme = (status: InviteStatusLabel) =>
  status === 'Accepted' ? 'green' : status === 'Expired' ? 'gray' : 'amber'
</script>
