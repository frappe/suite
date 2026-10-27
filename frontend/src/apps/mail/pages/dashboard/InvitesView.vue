<template>
  <div class="flex items-center justify-between gap-3">
    <FormControl v-model="search" :placeholder="__('Search')" class="w-80">
      <template #prefix>
        <span class="lucide-search size-4 text-ink-gray-5" aria-hidden="true" />
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

  <List
    v-model:selection="selectedInvites"
    selectable
    class="-mx-3 list-row-px-3"
    :columns="['minmax(0,1fr)', 'minmax(0,1fr)', 'minmax(0,1fr)', '8rem', '3rem']"
    :row-height="56"
  >
    <ListHeader>
      <ListHeaderCell>{{ __('Assigned Email') }}</ListHeaderCell>
      <ListHeaderCell>{{ __('Backup Email') }}</ListHeaderCell>
      <ListHeaderCell>{{ __('Invited By') }}</ListHeaderCell>
      <ListHeaderCell>{{ __('Invitation Status') }}</ListHeaderCell>
      <ListHeaderCell
        ><span class="sr-only">{{ __('Actions') }}</span></ListHeaderCell
      >
    </ListHeader>
    <ListRows v-if="list.status !== 'success'" v-slot="{ item }" :items="SKELETON_ROWS">
      <ListRow :value="item.name" class="pointer-events-none" aria-hidden="true">
        <ListCell><DashboardSkeletonText width="70%" /></ListCell>
        <ListCell><DashboardSkeletonText width="60%" /></ListCell>
        <ListCell><DashboardSkeletonText width="55%" /></ListCell>
        <ListCell><Skeleton class="h-5 w-16 rounded-4" /></ListCell>
        <ListCell />
      </ListRow>
    </ListRows>
    <ListRows v-else v-slot="{ item: invite }" :items="inviteRows">
      <ListRow :value="invite.name">
        <ListCell>
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-base text-ink-gray-8">{{ invite.account }}</span>
            <Tooltip v-if="invite.is_admin" :text="__('Admin')">
              <span
                class="lucide-shield-check size-3.5 shrink-0 text-ink-gray-5"
                role="img"
                :aria-label="__('Admin')"
              />
            </Tooltip>
          </div>
        </ListCell>
        <ListCell>
          <span class="truncate text-base text-ink-gray-7">{{ invite.backup_email || '—' }}</span>
        </ListCell>
        <ListCell>
          <span class="truncate text-base text-ink-gray-7">{{ invite.invited_by }}</span>
        </ListCell>
        <ListCell>
          <Badge :label="invite.status" :theme="getTheme(invite.status)" />
        </ListCell>
        <ListCell class="justify-end" @click.stop>
          <Button
            variant="ghost"
            icon="lucide-pencil"
            :label="__('Edit invite for {0}', [invite.account])"
            @click="editInvite(invite.name)"
          />
        </ListCell>
      </ListRow>
    </ListRows>
  </List>
  <div
    v-if="list.status === 'success' && !inviteRows.length"
    class="flex flex-col items-center gap-1 py-12 text-center"
  >
    <p class="text-base font-medium text-ink-gray-8">{{ emptyState.title }}</p>
    <p class="text-p-sm text-ink-gray-5">{{ emptyState.description }}</p>
  </div>
  <div v-if="selectedInvites.length" class="flex items-center gap-2">
    <p class="text-p-sm text-ink-gray-6">{{ __('{0} selected', [selectedInvites.length]) }}</p>
    <Button theme="red" :label="__('Delete selected invites')" @click="showDeleteInvites = true" />
  </div>
  <DashboardPager
    v-if="list.status === 'success' && list.total"
    :count="list.rows.length"
    :total="list.total ?? 0"
    :has-more="list.hasNext"
    :loading="list.isFetching"
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
import { Badge, Button, Dialog, FormControl, Skeleton, Tooltip } from 'frappe-ui'
import { List, ListCell, ListHeader, ListHeaderCell, ListRow, ListRows } from 'frappe-ui/list'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { api, useInfiniteQuery, useMutation, type InputOf } from '@/api'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'
import EditInviteModal from '@/apps/mail/components/Modals/EditInviteModal.vue'
import { raiseToast } from '@/apps/mail/utils'
import { DEFAULT_PAGE_LENGTH } from '@/apps/mail/utils/paging'
import { DashboardSkeletonText } from '@/platform/dashboard'

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
const list = useInfiniteQuery(api.mail.admin.invites.list, () => ({
  search: debouncedSearch.value,
  ...(status.value !== 'All'
    ? {
        status: status.value,
      }
    : {}),
  start: 0,
  page_length: DEFAULT_PAGE_LENGTH,
}))
const inviteRows = computed<InviteRow[]>(() =>
  list.rows.map((row) => ({
    ...row,
    is_admin: Boolean(row.is_admin),
    status: row.status,
  })),
)
const selectedInvites = ref<string[]>([])
const SKELETON_ROWS = Array.from({ length: 8 }, (_, index) => ({ name: `skeleton-${index}` }))

// Names no longer listed leave the selection, as on the accounts list.
watch(
  () => list.rows,
  (rows) => {
    const shown = new Set(rows.map((row) => row.name))
    selectedInvites.value = selectedInvites.value.filter((name) => shown.has(name))
  },
)
function editInvite(name: string) {
  selectedInvite.value = name
  showEditInvite.value = true
}
const reloadInvites = () => list.refetch().catch(() => {})
defineExpose({
  reloadInvites,
})
const deleteInvites = useMutation(api.mail.admin.members.deleteAccountRequests)
async function deleteInvitesSubmit() {
  const input: InputOf<typeof api.mail.admin.members.deleteAccountRequests> = {
    names: [...selectedInvites.value],
  }
  await deleteInvites.run(input)
  showDeleteInvites.value = false
  raiseToast(__('Invites deleted.'))
  selectedInvites.value = []
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
const hasActiveFilters = computed(() => !!search.value || status.value !== 'All')
const emptyState = computed(() =>
  hasActiveFilters.value
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
)
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
