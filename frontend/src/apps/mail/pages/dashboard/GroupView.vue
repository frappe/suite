<template>
  <DashboardLayout area="mail" :breadcrumbs="breadcrumbs" :loading="!member.data">
    <template #loading>
      <DashboardDetailHeaderSkeleton :actions="2" />
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <DashboardCard :title="__('General information')">
          <div>
            <InformationField :label="__('Receiving')"
              ><DashboardSkeletonText width="40%"
            /></InformationField>
            <InformationField :label="__('Added')"
              ><DashboardSkeletonText width="40%"
            /></InformationField>
          </div>
        </DashboardCard>
        <DashboardCard :title="__('Mail storage usage')">
          <div class="space-y-2 p-5 text-base">
            <DashboardSkeletonText width="30%" />
          </div>
        </DashboardCard>
        <DashboardCard :title="__('Email addresses')">
          <div class="flex flex-col">
            <div
              class="bg-surface-gray-2 text-ink-gray-5 flex items-center rounded-4 px-5 py-2.5 text-sm"
            >
              <span class="flex-1">{{ __('Email address') }}</span>
              <span class="w-20 shrink-0 text-center">{{ __('Enabled') }}</span>
              <span class="w-8 shrink-0" />
            </div>
            <!-- An address row with its display name beneath is two lines tall. -->
            <DashboardRowsSkeleton
              :rows="1"
              row-class="flex h-[3.875rem] items-center border-b px-5 last:border-b-0"
            />
          </div>
        </DashboardCard>
        <DashboardCard :title="__('Members')">
          <div class="flex flex-col">
            <div class="px-5 py-2.5"><Skeleton class="h-7 w-full rounded-4" /></div>
            <DashboardRowsSkeleton :rows="1" />
          </div>
        </DashboardCard>
      </div>
    </template>
    <template v-if="member.data">
      <DashboardDetailHeader
        :title="member.data.email || member.data.name || groupId"
        :meta="[member.data.description, memberCountLabel]"
      >
        <template #icon><Users class="h-5 w-5" /></template>
        <template #actions>
          <Button :label="__('Edit')" @click="showEdit = true" />
          <Dropdown
            :options="dropdownOptions"
            :button="{ icon: 'lucide-more-horizontal' }"
            align="end"
          />
        </template>
      </DashboardDetailHeader>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <!-- The description is already under the title in the header. -->
        <DashboardCard :title="__('General information')">
          <div>
            <InformationField
              :label="__('Receiving')"
              :value="member.data.disable_receiving ? __('Disabled') : __('Enabled')"
            />
            <InformationField :label="__('Added')" :value="createdAt" />
          </div>
        </DashboardCard>

        <!-- Quota Usage -->
        <DashboardCard :title="__('Mail storage usage')">
          <p class="p-5 text-base text-ink-gray-7">
            {{
              member.data.used_bytes == null
                ? __('Mail usage unavailable')
                : __('{0} GB · Mail has no storage limit', [
                    (member.data.used_bytes / 1_000_000_000).toLocaleString(),
                  ])
            }}
          </p>
        </DashboardCard>

        <!-- Email Addresses -->
        <DashboardCard
          :title="__('Email addresses')"
          :button-label="__('Add')"
          @action="showAddEmail = true"
        >
          <div class="flex flex-col">
            <div
              class="bg-surface-gray-2 text-ink-gray-5 flex items-center rounded-4 px-5 py-2.5 text-sm"
            >
              <span class="flex-1">{{ __('Email address') }}</span>
              <span class="w-20 shrink-0 text-center">{{ __('Enabled') }}</span>
              <span class="w-8 shrink-0" />
            </div>
            <template v-if="member.data.email_addresses.length">
              <div
                v-for="entry in member.data.email_addresses"
                :key="entry.email"
                class="group border-b px-5 py-3 text-base last:border-b-0"
              >
                <Tooltip
                  class="block"
                  :text="__('This is the primary address and cannot be removed.')"
                  :disabled="!entry.is_primary"
                >
                  <div class="flex w-full items-center">
                    <!-- The address gets the whole width; its display name sits beneath. -->
                    <span class="min-w-0 flex-1">
                      <span class="block truncate">{{ entry.email }}</span>
                      <span v-if="entry.description" class="text-ink-gray-5 block truncate text-sm">
                        {{ entry.description }}
                      </span>
                    </span>
                    <span class="flex w-20 shrink-0 justify-center">
                      <Switch
                        :model-value="entry.enabled"
                        :disabled="entry.is_primary"
                        @update:model-value="(value) => toggleEmailEnabled(entry, value)"
                      />
                    </span>
                    <span class="flex w-8 shrink-0 justify-end">
                      <Button
                        v-if="!entry.is_primary"
                        variant="ghost"
                        theme="red"
                        class="invisible group-hover:visible"
                        @click="removeEmail(entry.email)"
                      >
                        <template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
                      </Button>
                    </span>
                  </div>
                </Tooltip>
              </div>
            </template>
            <div v-else class="text-ink-gray-5 px-5 py-6 text-center text-sm">
              {{ __('No email addresses found.') }}
            </div>
          </div>
        </DashboardCard>

        <!-- Members -->
        <DashboardCard
          :title="__('Members')"
          :button-label="__('Add')"
          @action="showAddMembers = true"
        >
          <div class="flex flex-col">
            <div class="px-5 py-2.5">
              <FormControl v-model="memberSearch" :placeholder="__('Search by email address')">
                <template #prefix>
                  <FeatherIcon name="search" class="text-ink-gray-5 w-4" />
                </template>
              </FormControl>
            </div>
            <template v-if="filteredMembers.length">
              <div
                v-for="m in filteredMembers"
                :key="m.id"
                class="group hover:bg-surface-gray-2 flex cursor-pointer items-center border-b px-5 py-3 text-base last:border-b-0"
                @click="
                  m.email && router.push({ name: 'mail-account', params: { accountId: m.email } })
                "
              >
                <span class="flex-1 truncate">{{ m.email || m.name }}</span>
                <Button
                  variant="ghost"
                  theme="red"
                  class="invisible group-hover:visible"
                  @click.stop="removeMember(m.id)"
                >
                  <template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
                </Button>
              </div>
            </template>
            <div v-else class="text-ink-gray-5 px-5 py-6 text-center text-sm">
              {{ __('No members found.') }}
            </div>
          </div>
        </DashboardCard>
      </div>
    </template>
  </DashboardLayout>
  <EditGroupModal
    v-if="member.data"
    v-model="showEdit"
    :group="member.data"
    @reload="member.refetch().catch(() => {})"
  />
  <AddGroupEmailModal
    v-model="showAddEmail"
    :group-id="groupId"
    @reload="member.refetch().catch(() => {})"
  />
  <AddGroupMembersModal
    v-model="showAddMembers"
    :group-id="groupId"
    :current-ids="currentMemberIds"
    @reload="member.refetch().catch(() => {})"
  />
</template>
<script setup lang="ts">
import Users from '~icons/lucide/users'
import {
  Button,
  dialog,
  Dropdown,
  FormControl,
  Skeleton,
  Switch,
  Tooltip,
  usePageMeta,
} from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, client, useMutation, useQuery, type InputOf } from '@/api'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DashboardDetailHeaderSkeleton from '@/apps/mail/components/DashboardDetailHeaderSkeleton.vue'
import AddGroupEmailModal from '@/apps/mail/components/Modals/AddGroupEmailModal.vue'
import AddGroupMembersModal from '@/apps/mail/components/Modals/AddGroupMembersModal.vue'
import EditGroupModal from '@/apps/mail/components/Modals/EditGroupModal.vue'
import type { QuotaUsage } from '@/apps/mail/types'
import { raiseError, raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import {
  DashboardCard,
  DashboardLayout,
  DashboardRowsSkeleton,
  DashboardSkeletonText,
  InformationField,
} from '@/platform/dashboard'
import { appPageMeta } from '@/platform/page-meta'

type GroupData = {
  id: string
  name: string
  email: string
  description?: string
  disable_receiving: boolean
  created_at?: string
  email_addresses: {
    email: string
    description?: string
    is_primary: boolean
    enabled: boolean
  }[]
  members: {
    id: string
    name?: string
    email?: string
  }[]
  quota: QuotaUsage
}
const { groupId } = defineProps<{
  groupId: string
}>()
const router = useRouter()
const showEdit = ref(false)
const showAddEmail = ref(false)
const showAddMembers = ref(false)
const memberSearch = ref('')

// Named `member` so the quota/card markup mirrors AccountView.vue one-to-one.
const member = useQuery(api.mail.admin.groups.get, () => ({
  group_id: groupId,
}))
// SAFETY: suite/mail/api/admin.py::get_group owns this response projection; undefined represents a pending query.
usePageMeta(() => appPageMeta((member.data as GroupData | undefined)?.email || groupId, 'Mail'))
watch(
  () => member.error,
  (error) => {
    if (!error) return
    raiseError(error)
    router.replace({
      name: 'mail-groups',
    })
  },
)
// SAFETY: suite/mail/api/admin.py::get_group owns this response projection; undefined represents a pending query.
const data = computed(() => member.data as GroupData | undefined)
const currentMemberIds = computed(() => data.value?.members.map((m) => m.id) || [])
const filteredMembers = computed(() => {
  const members = data.value?.members || []
  const q = memberSearch.value.trim().toLowerCase()
  return q ? members.filter((m) => (m.email || '').toLowerCase().includes(q)) : members
})
const createdAt = computed(() => formatDateTime(data.value?.created_at))
const memberCountLabel = computed(() => {
  const count = data.value?.members.length ?? 0
  return count === 1 ? __('1 member') : __('{0} members', [String(count)])
})
const breadcrumbs = computed(() => [
  {
    label: __('Groups'),
    route: '/admin/mail/groups',
  },
  {
    label: data.value?.email || groupId,
  },
])
const toggleEmailEnabled = async (
  entry: {
    email: string
    enabled: boolean
  },
  value: boolean,
) => {
  await client.mutation(api.mail.admin.groups.setEmailEnabled, {
    group_id: groupId,
    email: entry.email,
    enabled: value ? 1 : 0,
  })
  raiseToast(value ? __('Email address enabled.') : __('Email address disabled.'))
}
const removeEmail = async (email: string) => {
  await client.mutation(api.mail.admin.groups.removeEmail, {
    group_id: groupId,
    email,
  })
  member.refetch().catch(() => {})
  raiseToast(__('Email address removed.'))
}
const removeMember = async (accountId: string) => {
  await client.mutation(api.mail.admin.groups.removeMember, {
    group_id: groupId,
    account_id: accountId,
  })
  member.refetch().catch(() => {})
  raiseToast(__('Member removed.'))
}
async function setReceiving(enabled: boolean) {
  await client.mutation(api.mail.admin.groups.setReceivingEnabled, {
    group_id: groupId,
    enabled,
  })
  raiseToast(enabled ? __('Receiving enabled.') : __('Receiving disabled.'))
}
function confirmToggleReceiving() {
  const enabling = Boolean(data.value?.disable_receiving)
  dialog.confirm({
    title: enabling ? __('Enable receiving?') : __('Disable receiving?'),
    message: enabling
      ? __('Mail addressed to this group will be delivered again.')
      : __(
          'Mail addressed to this group bounces back to the sender until receiving is enabled again.',
        ),
    theme: enabling ? 'blue' : 'amber',
    confirmLabel: enabling ? __('Enable receiving') : __('Disable receiving'),
    onConfirm: () => setReceiving(enabling),
  })
}
const deleteGroup = useMutation(api.mail.admin.groups.delete)
async function deleteGroupSubmit() {
  const input: InputOf<typeof api.mail.admin.groups.delete> = {
    ids: [groupId],
  }
  await deleteGroup.run(input)
  raiseToast(__('Group deleted.'))
  router.push({
    name: 'mail-groups',
  })
}
function confirmDeleteGroup() {
  dialog.confirm({
    title: __('Delete this group?'),
    message: __('The group and its addresses are deleted. This cannot be undone.'),
    theme: 'red',
    confirmLabel: __('Delete group'),
    onConfirm: deleteGroupSubmit,
  })
}
const dropdownOptions = computed(() => [
  {
    group: '',
    options: [
      data.value?.disable_receiving
        ? {
            label: __('Enable receiving'),
            icon: 'lucide-mail-check',
            onClick: confirmToggleReceiving,
          }
        : {
            label: __('Disable receiving'),
            icon: 'lucide-mail-x',
            onClick: confirmToggleReceiving,
          },
      {
        label: __('Delete group'),
        icon: 'lucide-trash-2',
        onClick: confirmDeleteGroup,
      },
    ],
  },
])
</script>
