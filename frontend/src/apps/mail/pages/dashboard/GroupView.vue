<template>
  <DashboardLayout area="mail" :breadcrumbs="breadcrumbs" :loading="!member.data">
    <template v-if="member.data">
      <DashboardDetailHeader
        :title="member.data.email || member.data.name || groupId"
        :meta="[member.data.description, memberCountLabel]"
      >
        <template #icon><Users class="h-5 w-5" /></template>
        <template #actions>
          <Button :label="__('Edit')" @click="showEdit = true" />
          <Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
        </template>
      </DashboardDetailHeader>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <!-- General Information -->
        <DashboardCard :title="__('General Information')">
          <div>
            <InformationField
              :label="__('Description')"
              :value="member.data.description ?? undefined"
            />
            <InformationField
              :label="__('Receiving')"
              :value="member.data.disable_receiving ? __('Disabled') : __('Enabled')"
            />
            <InformationField :label="__('Created At')" :value="createdAt" />
          </div>
        </DashboardCard>

        <!-- Quota Usage -->
        <DashboardCard
          :title="__('Quota Usage')"
          :button-label="__('Edit')"
          @action="showEditQuota = true"
        >
          <QuotaDonut :quota="member.data.quota" />
        </DashboardCard>

        <!-- Email Addresses -->
        <DashboardCard
          :title="__('Email Addresses')"
          :button-label="__('Add')"
          @action="showAddEmail = true"
        >
          <div class="flex flex-col">
            <div
              class="bg-surface-gray-2 text-ink-gray-5 flex items-center rounded-4 px-5 py-2.5 text-sm"
            >
              <span class="flex-1">{{ __('Email Address') }}</span>
              <span class="flex-1">{{ __('Description') }}</span>
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
                    <span class="flex-1 truncate">{{ entry.email }}</span>
                    <span class="text-ink-gray-5 flex-1 truncate">{{
                      entry.description || '—'
                    }}</span>
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
              <FormControl v-model="memberSearch" :placeholder="__('Search by email')">
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
  <EditGroupQuotaModal
    v-if="member.data"
    v-model="showEditQuota"
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
  <Dialog v-model:open="showToggleReceiving" v-bind="toggleReceivingDialogOptions" />
  <Dialog v-model:open="showDelete" v-bind="deleteDialogOptions" />
</template>
<script setup lang="ts">
import Users from '~icons/lucide/users'
import { Button, Dialog, Dropdown, FormControl, Switch, Tooltip, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, client, useMutation, useQuery, type InputOf } from '@/api'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import AddGroupEmailModal from '@/apps/mail/components/Modals/AddGroupEmailModal.vue'
import AddGroupMembersModal from '@/apps/mail/components/Modals/AddGroupMembersModal.vue'
import EditGroupModal from '@/apps/mail/components/Modals/EditGroupModal.vue'
import EditGroupQuotaModal from '@/apps/mail/components/Modals/EditGroupQuotaModal.vue'
import QuotaDonut from '@/apps/mail/components/QuotaDonut.vue'
import type { QuotaUsage } from '@/apps/mail/types'
import { raiseError, raiseToast } from '@/apps/mail/utils'
import { formatDateTime } from '@/apps/mail/utils/datetime'
import { DashboardCard, DashboardLayout, InformationField } from '@/platform/dashboard'
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
usePageMeta(() => appPageMeta((member.data as GroupData | undefined)?.email || groupId, 'Mail'))
const showEdit = ref(false)
const showEditQuota = ref(false)
const showAddEmail = ref(false)
const showAddMembers = ref(false)
const showToggleReceiving = ref(false)
const showDelete = ref(false)
const memberSearch = ref('')

// Named `member` so the quota/card markup mirrors AccountView.vue one-to-one.
const member = useQuery(api.mail.admin.groups.get, () => ({
  group_id: groupId,
}))
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
    route: '/mail/dashboard/groups',
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
  showToggleReceiving.value = false
  raiseToast(enabled ? __('Receiving enabled.') : __('Receiving disabled.'))
}
const toggleReceivingDialogOptions = computed(() => {
  const enabling = Boolean(data.value?.disable_receiving)
  return {
    title: enabling ? __('Enable Receiving') : __('Disable Receiving'),
    message: enabling
      ? __(
          'Are you sure you want to enable receiving for this group? Mail addressed to it will be delivered again.',
        )
      : __(
          'Are you sure you want to disable receiving for this group? Mail addressed to it will bounce back to the sender.',
        ),
    actions: [
      {
        label: __('Confirm'),
        variant: 'solid' as const,
        onClick: () => setReceiving(enabling),
      },
    ],
  }
})
const deleteGroup = useMutation(api.mail.admin.groups.delete)
async function deleteGroupSubmit() {
  const input: InputOf<typeof api.mail.admin.groups.delete> = {
    ids: [groupId],
  }
  await deleteGroup.run(input)
  showDelete.value = false
  raiseToast(__('Group deleted.'))
  router.push({
    name: 'mail-groups',
  })
}
const deleteDialogOptions = computed(() => ({
  title: __('Delete Group'),
  message: __('Are you sure you want to delete this group? This action cannot be undone.'),
  size: 'xl' as const,
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      theme: 'red' as const,
      onClick: deleteGroupSubmit,
    },
  ],
}))
const dropdownOptions = computed(() => [
  {
    group: '',
    options: [
      data.value?.disable_receiving
        ? {
            label: __('Enable Receiving'),
            icon: 'lucide-mail-check',
            onClick: () => (showToggleReceiving.value = true),
          }
        : {
            label: __('Disable Receiving'),
            icon: 'lucide-mail-x',
            onClick: () => (showToggleReceiving.value = true),
          },
      {
        label: __('Delete'),
        icon: 'lucide-trash-2',
        onClick: () => (showDelete.value = true),
      },
    ],
  },
])
</script>
