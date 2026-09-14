<template>
  <SettingList>
    <div class="flex items-center gap-3">
      <Avatar size="2xl" :image="USER.avatar" :label="USER.name" />
      <div class="min-w-0 flex-1">
        <div class="text-base font-medium text-ink-gray-8">Profile picture</div>
        <p class="mt-0.5 text-p-sm text-ink-gray-6">Shown beside mail you send.</p>
      </div>
      <Button label="Change" />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <label class="block min-w-0">
        <span class="text-p-sm text-ink-gray-6">First name</span>
        <TextInput v-model="firstName" class="mt-1 w-full" />
      </label>
      <label class="block min-w-0">
        <span class="text-p-sm text-ink-gray-6">Last name</span>
        <TextInput v-model="lastName" class="mt-1 w-full" />
      </label>
    </div>

    <SettingRow title="Username" description="The address you sign in with.">
      <span class="text-base text-ink-gray-7">{{ username }}</span>
    </SettingRow>

    <SettingRow title="Password" description="Change the password for this account.">
      <Button label="Update password" />
    </SettingRow>

    <SettingRow
      title="Backup email"
      description="Where we write if you lose access to this account."
    >
      <TextInput v-model="backupEmail" class="w-60" />
    </SettingRow>

    <div>
      <div class="flex items-baseline justify-between gap-6">
        <div class="text-base font-medium text-ink-gray-8">Storage</div>
        <span class="text-p-sm text-ink-gray-6">{{ storagePercent }}% of 10 GB used</span>
      </div>
      <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-gray-2">
        <div
          class="h-full rounded-full bg-surface-gray-7"
          :style="{ width: `${Math.max(storagePercent, 0.5)}%` }"
        />
      </div>
    </div>
  </SettingList>
</template>

<script setup lang="ts">
import { Avatar, Button, TextInput } from 'frappe-ui'

import { USER } from '../../fixtures'
import { backupEmail, firstName, lastName, storagePercent, username } from '../../mailSettings'
import SettingList from './SettingList.vue'
import SettingRow from './SettingRow.vue'
</script>
