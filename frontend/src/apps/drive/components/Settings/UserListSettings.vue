<template>
  <AppSettingsHeader :title="__('Users')">
    <template #actions>
      <Button
        v-if="isAdmin.data?.is_admin"
        :label="__('Invite')"
        :icon-left="h(LucideMail, { class: 'size-4' })"
        @click="showInvite = true"
      />
    </template>
  </AppSettingsHeader>
  <AppSettingsBody>
    <Alert v-if="invite" type="info" :icon="LucideMail" class="mb-4">
      <template #actions>
        <Button
          variant="ghost"
          class="my-auto"
          @click="rejectInvite.submit({ key: invite.name }), getInvites.data.shift()"
        >
          <LucideX class="size-4" />
        </Button>
        <Button
          class="my-auto"
          variant="outline"
          @click="
            acceptInvite.submit(
              { key: invite.name, redirect: 0 },
              { onSuccess: () => getInvites.fetch() }
            )
          "
        >
          <LucideCheck class="size-4" />
        </Button>
      </template>
      <div class="py-1 flex justify-between">
        <div>You have an invite to join this Drive.</div>
      </div>
    </Alert>
    <Tabs v-model="tab" :tabs>
      <template #tab-panel="{ tab }">
        <template v-if="tab.value === 'members'">
          <div class="flex flex-col overflow-y-auto divide-y divide-outline-elevation-2">
            <div
              v-for="user in siteUsers?.data"
              :key="user.name"
              class="flex items-center justify-start pr-4 gap-x-3 py-2"
            >
              <Avatar :image="user.user_image" :label="user.full_name" size="lg" />
              <div class="flex flex-col gap-0.5">
                <span class="text-base text-ink-gray-8">{{ user.full_name }}</span>
                <span class="text-xs text-ink-gray-6">{{ user.email }}</span>
              </div>
              <span v-if="user.name === currentUserId" class="ml-auto text-base text-ink-gray-6">
                (you)
              </span>
            </div>
          </div>
        </template>
        <template v-else>
          <div
            v-if="!invites?.data || !invites.data.length"
            class="text-ink-gray-8 text-center text-p-sm py-4"
          >
            No invites found.
          </div>
          <div v-for="(pending, index) in invites?.data" :key="pending.name">
            <div v-if="index > 0" class="w-[95%] mx-auto h-px border-t border-outline-elevation-2" />
            <div class="flex items-center justify-start py-2 pl-2 pr-4 gap-x-3">
              <div class="flex justify-between w-full">
                <div class="flex flex-col gap-0.5">
                  <span class="text-base my-auto text-ink-gray-8">{{ pending.email }}</span>
                  <span class="text-xs text-ink-gray-5"
                    >Invited by
                    <UserTooltip :email="pending.owner" />
                  </span>
                </div>
                <div class="flex">
                  <Tooltip
                    :text="
                      pending.status === 'Proposed'
                        ? 'A person from your domain has joined Drive.'
                        : 'This invite is pending.'
                    "
                  >
                    <Badge
                      :theme="pending.status === 'Pending' ? 'gray' : 'amber'"
                      variant="subtle"
                      class="my-auto mr-2"
                      size="sm"
                    >
                      {{ __(pending.status) }}
                    </Badge>
                  </Tooltip>
                  <Button
                    variant="outline"
                    class="my-auto"
                    @click="rejectInvite.submit({ key: pending.name }), invites.data.splice(index, 1)"
                  >
                    <LucideTrash class="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>
    </Tabs>

    <Dialog v-model:open="showInvite" :title="__('Invite people to Drive')" size="lg">
      <div class="flex items-start justify-start gap-4">
        <div class="flex flex-wrap gap-1 rounded-4 w-full bg-surface-gray-2 p-2">
          <Button
            v-for="(email, idx) in invited"
            :key="email"
            :label="email"
            variant="outline"
            class="shadow-sm"
          >
            <template #suffix>
              <LucideX class="h-4" stroke-width="1.5" @click.stop="() => invited.splice(idx, 1)" />
            </template>
          </Button>
          <div class="min-w-[10rem] flex-1">
            <input
              v-model="emailInput"
              type="text"
              autocomplete="off"
              placeholder="Enter email address"
              class="h-7 w-full rounded-4 border-none bg-surface-gray-2 py-1.5 pl-2 pr-2 text-base text-ink-gray-8 placeholder-ink-gray-4 transition-colors focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
              @keydown="isValidEmail"
              @keydown.enter.capture.stop="extractEmails"
              @keydown.space.prevent.stop="extractEmails"
            />
          </div>
        </div>
      </div>
      <Button
        class="w-full mt-4"
        variant="solid"
        label="Send Invitation"
        :disabled="!emailTest().length && !invited.length"
        :loading="inviteUsers.loading"
        @click="
          () => {
            extractEmails()
            showInvite = false
            inviteUsers.submit({ emails: invited.join(',') })
          }
        "
      />
    </Dialog>
  </AppSettingsBody>
</template>

<script setup>
import { h, computed, ref } from 'vue'
import { useSessionStore } from '@/boot/session'
import {
  getInvites,
  rejectInvite,
  acceptInvite,
  isAdmin,
  siteUsers,
} from '@/apps/drive/resources/permissions'
import {
  Avatar,
  Dialog,
  Badge,
  Tabs,
  Tooltip,
  createResource,
  Button,
} from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import { toast } from '@/apps/drive/utils/toasts'
import LucideMail from '~icons/lucide/mail'
import LucideUsers from '~icons/lucide/users'
import LucideCheck from '~icons/lucide/check'
import LucideTrash from '~icons/lucide/trash'
import LucideX from '~icons/lucide/x'
import Alert from '@/apps/drive/components/Alert.vue'
import UserTooltip from '@/apps/drive/components/UserTooltip.vue'

const currentUserId = computed(() => useSessionStore().user)
const tab = ref('members')

siteUsers.fetch()
const invites = createResource({
  url: 'suite.drive.api.product.get_pending_invites',
})
isAdmin.fetch(null, {
  // Pending invites are admin-only; only fetch them once the user qualifies.
  onSuccess: (d) => {
    if (d?.is_admin) invites.fetch()
  },
})

const invited = ref([])
const emailInput = ref('')
const showInvite = ref(false)

// iconLeft, not icon: `icon` makes an icon-only trigger and drops the label.
const tabs = computed(() => [
  {
    value: 'members',
    label: 'Members',
    iconLeft: h(LucideUsers, { class: 'size-4' }),
  },
  // Invite management is admin-only.
  ...(isAdmin.data?.is_admin
    ? [
        {
          value: 'invites',
          label: 'Invites',
          iconLeft: h(LucideMail, { class: 'size-4' }),
        },
      ]
    : []),
])

function emailTest() {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailInput.value
    .split(/,|\s/)
    .filter((email) => email)
    .filter((email) => emailRegex.test(email))
    .filter((email) => !invited.value.includes(email))
}

function extractEmails() {
  invited.value = [...invited.value, ...emailTest()]
  emailInput.value = ''
}

const inviteUsers = createResource({
  url: 'suite.drive.api.product.invite_users',
  onSuccess: () => {
    invites.fetch()
    toast('Invite sent!')
  },
})

getInvites.fetch()
const invite = computed(() => (getInvites.data?.length ? getInvites.data[0] : null))
</script>
