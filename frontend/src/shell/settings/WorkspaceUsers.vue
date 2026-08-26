<template>
  <section>
    <div class="flex flex-col gap-4">
      <h2 class="text-md-semibold text-ink-gray-8">{{ __('Users') }}</h2>
      <div class="flex items-center justify-between gap-3">
        <TextInput
          v-model="search"
          class="w-72"
          :placeholder="__('Search by name or email')"
          :debounce="300"
        >
          <template #prefix>
            <span class="lucide-search size-4 text-ink-gray-4" />
          </template>
        </TextInput>
        <Button icon-left="lucide-plus" @click="showInviteDialog = true">
          {{ __('Invite') }}
        </Button>
      </div>
    </div>
    <div class="mt-3 divide-y divide-outline-gray-1">
      <div
        v-for="user in filteredUsers"
        :key="user.name"
        class="flex items-center justify-between gap-3 py-2.5"
      >
        <div class="flex min-w-0 items-center gap-3">
          <Avatar size="lg" :image="user.user_image" :label="user.full_name || user.email" />
          <div class="min-w-0">
            <div class="truncate text-p-base text-ink-gray-8">
              {{ user.full_name || user.email }}
            </div>
            <div class="truncate text-p-sm text-ink-gray-5">{{ user.email }}</div>
          </div>
        </div>
        <Badge v-if="user.is_admin" theme="blue" variant="outline">{{ __('Admin') }}</Badge>
      </div>
      <div
        v-for="invite in filteredInvites"
        :key="invite.name"
        class="flex items-center justify-between gap-3 py-2.5"
      >
        <div class="flex min-w-0 items-center gap-3">
          <Avatar size="lg" :label="invite.email" />
          <div class="min-w-0">
            <div class="truncate text-p-base text-ink-gray-8">{{ invite.email }}</div>
            <div class="truncate text-p-sm text-ink-gray-5">
              {{ __('Invited by {0}', [invite.invited_by_name || invite.invited_by]) }}
            </div>
          </div>
        </div>
        <Badge theme="amber" variant="outline">{{ __('Invited') }}</Badge>
      </div>
    </div>
  </section>

  <Dialog v-model:open="showInviteDialog" :title="__('Invite users')" :actions="inviteActions">
    <InviteStep
      ref="inviteStep"
      :prefill="search.trim()"
      :description="__('Separate multiple email addresses with commas or new lines')"
      autofocus
      @sent="onInvitesSent"
    />
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Avatar, Badge, Button, Dialog, TextInput, createResource, toast } from 'frappe-ui'

import InviteStep from '@/shell/InviteStep.vue'

const users = createResource({ url: 'suite.api.account.get_users', auto: true, initialData: [] })

const pendingInvites = createResource({
  url: 'suite.api.account.get_pending_invites',
  auto: true,
  initialData: [],
})

const search = ref('')

function matchesSearch(...values: (string | undefined)[]) {
  const term = search.value.trim().toLowerCase()
  return !term || values.some((value) => (value || '').toLowerCase().includes(term))
}

const filteredUsers = computed(() =>
  users.data.filter((user) => matchesSearch(user.full_name, user.email)),
)

const filteredInvites = computed(() =>
  pendingInvites.data.filter((invite) => matchesSearch(invite.email)),
)

const showInviteDialog = ref(false)
const inviteStep = ref<InstanceType<typeof InviteStep>>()

const inviteActions = computed(() => [
  {
    label: __('Send invites'),
    variant: 'solid' as const,
    disabled: !inviteStep.value?.canSubmit,
    onClick: () => inviteStep.value?.submit(),
  },
])

function onInvitesSent(summary: string) {
  showInviteDialog.value = false
  toast.success(summary)
  pendingInvites.reload()
}
</script>
