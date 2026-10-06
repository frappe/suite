<template>
  <DashboardLayout area="mail" :breadcrumbs="breadcrumbs" :loading="!list.data">
    <template v-if="list.data">
      <DashboardDetailHeader
        :title="list.data.email || list.data.name || listId"
        :meta="[list.data.description, recipientCountLabel]"
      >
        <template #icon><Megaphone class="h-5 w-5" /></template>
        <template #actions>
          <Button :label="__('Edit')" @click="showEdit = true" />
          <Dropdown :options="dropdownOptions" :button="{ icon: 'lucide-more-horizontal' }" />
        </template>
      </DashboardDetailHeader>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
            <template v-if="list.data.email_addresses.length">
              <div
                v-for="entry in list.data.email_addresses"
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

        <!-- Recipients -->
        <DashboardCard
          :title="__('Recipients')"
          :button-label="__('Add')"
          @action="showAddRecipients = true"
        >
          <div class="flex flex-col">
            <div class="px-5 py-2.5">
              <FormControl v-model="recipientSearch" :placeholder="__('Search by email')">
                <template #prefix>
                  <FeatherIcon name="search" class="text-ink-gray-5 w-4" />
                </template>
              </FormControl>
            </div>
            <template v-if="recipients.rows.length">
              <div
                v-for="recipient in recipients.rows"
                :key="recipient.email"
                class="group flex items-center border-b px-5 py-3 text-base last:border-b-0"
              >
                <span class="flex-1 truncate">{{ recipient.email }}</span>
                <Button
                  variant="ghost"
                  theme="red"
                  class="invisible group-hover:visible"
                  @click="removeRecipient(recipient.email)"
                >
                  <template #icon><FeatherIcon name="x" class="h-4 w-4" /></template>
                </Button>
              </div>
            </template>
            <div
              v-else-if="recipients.status === 'success'"
              class="text-ink-gray-5 px-5 py-6 text-center text-sm"
            >
              {{ __('No recipients found.') }}
            </div>
            <DashboardPager
              v-if="recipients.status === 'success' && recipients.total"
              :count="recipients.rows.length"
              :total="recipients.total ?? 0"
              :page-length="pageLength"
              :has-more="recipients.hasNext"
              :loading="recipients.isFetching"
              :flush="false"
              @update:page-length="(value) => (pageLength = value)"
              @load-more="recipients.fetchNext().catch(() => {})"
            />
          </div>
        </DashboardCard>
      </div>
    </template>
  </DashboardLayout>
  <EditMailingListModal
    v-if="list.data"
    v-model="showEdit"
    :list="list.data"
    @reload="reloadAll()"
  />
  <AddMailingListEmailModal v-model="showAddEmail" :list-id="listId" @reload="reloadAll()" />
  <AddMailingListRecipientsModal
    v-model="showAddRecipients"
    :list-id="listId"
    @reload="reloadAll()"
  />
  <Dialog v-model:open="showDelete" v-bind="deleteDialogOptions" />
</template>
<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import Megaphone from '~icons/lucide/megaphone'
import { Button, Dialog, Dropdown, FormControl, Switch, Tooltip, usePageMeta } from 'frappe-ui'
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, client, useInfiniteQuery, useMutation, useQuery, type InputOf } from '@/api'
import DashboardDetailHeader from '@/apps/mail/components/DashboardDetailHeader.vue'
import DashboardPager from '@/apps/mail/components/DashboardPager.vue'
import AddMailingListEmailModal from '@/apps/mail/components/Modals/AddMailingListEmailModal.vue'
import AddMailingListRecipientsModal from '@/apps/mail/components/Modals/AddMailingListRecipientsModal.vue'
import EditMailingListModal from '@/apps/mail/components/Modals/EditMailingListModal.vue'
import { raiseError, raiseToast } from '@/apps/mail/utils'
import { DEFAULT_PAGE_LENGTH, type PageLength } from '@/apps/mail/utils/paging'
import { DashboardCard, DashboardLayout } from '@/platform/dashboard'
import { appPageMeta } from '@/platform/page-meta'

type ListData = {
  id: string
  name: string
  email: string
  description?: string
  email_addresses: {
    email: string
    description?: string
    is_primary: boolean
    enabled: boolean
  }[]
  recipient_total: number
}
const { listId } = defineProps<{
  listId: string
}>()
const router = useRouter()
usePageMeta(() => appPageMeta((list.data as ListData | undefined)?.email || listId, 'Mail'))
const showEdit = ref(false)
const showAddEmail = ref(false)
const showAddRecipients = ref(false)
const showDelete = ref(false)
const recipientSearch = ref('')
const list = useQuery(api.mail.admin.mailingLists.get, () => ({
  list_id: listId,
}))
watch(
  () => list.error,
  (error) => {
    if (!error) return
    raiseError(error)
    router.replace({
      name: 'mail-mailing-lists',
    })
  },
)
const data = computed(() => list.data as ListData | undefined)

// Recipients are searched and paged on Suite Cloud: a list can hold thousands, and the detail
// call only carries the total, which the header shows.
const debouncedSearch = refDebounced(recipientSearch, 300)
const pageLength = ref<PageLength>(DEFAULT_PAGE_LENGTH)
const recipients = useInfiniteQuery(api.mail.admin.recipients.list, () => ({
  list_id: listId,
  search: debouncedSearch.value,
  start: 0,
  page_length: pageLength.value,
}))
const reloadAll = () => {
  list.refetch().catch(() => {})
  recipients.refetch().catch(() => {})
}
const recipientCountLabel = computed(() => {
  const count = data.value?.recipient_total ?? 0
  return count === 1 ? __('1 recipient') : __('{0} recipients', [String(count)])
})
const breadcrumbs = computed(() => [
  {
    label: __('Mailing Lists'),
    route: '/mail/dashboard/mailing-lists',
  },
  {
    label: data.value?.email || listId,
  },
])
const toggleEmailEnabled = async (
  entry: {
    email: string
    enabled: boolean
  },
  value: boolean,
) => {
  await client.mutation(api.mail.admin.mailingLists.setEmailEnabled, {
    list_id: listId,
    email: entry.email,
    enabled: value ? 1 : 0,
  })
  raiseToast(value ? __('Email address enabled.') : __('Email address disabled.'))
}
const removeEmail = async (email: string) => {
  await client.mutation(api.mail.admin.mailingLists.removeEmail, {
    list_id: listId,
    email,
  })
  reloadAll()
  raiseToast(__('Email address removed.'))
}
const removeRecipient = async (email: string) => {
  await client.mutation(api.mail.admin.mailingLists.removeRecipient, {
    list_id: listId,
    email,
  })
  reloadAll()
  raiseToast(__('Recipient removed.'))
}
const deleteList = useMutation(api.mail.admin.mailingLists.delete)
async function deleteListSubmit() {
  const input: InputOf<typeof api.mail.admin.mailingLists.delete> = {
    ids: [listId],
  }
  await deleteList.run(input)
  showDelete.value = false
  raiseToast(__('Mailing list deleted.'))
  router.push({
    name: 'mail-mailing-lists',
  })
}
const deleteDialogOptions = computed(() => ({
  title: __('Delete Mailing List'),
  message: __('Are you sure you want to delete this mailing list? This action cannot be undone.'),
  size: 'xl' as const,
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      theme: 'red' as const,
      onClick: deleteListSubmit,
    },
  ],
}))
const dropdownOptions = computed(() => [
  {
    group: '',
    options: [
      {
        label: __('Delete'),
        icon: 'lucide-trash-2',
        onClick: () => (showDelete.value = true),
      },
    ],
  },
])
</script>
