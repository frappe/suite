<template>
  <Dialog
    v-model:open="open"
    :title="__('Create share link')"
    size="md"
    :dismissible="!pending"
    :show-close-button="!pending"
  >
    <form id="create-share-link" class="space-y-4" @submit.prevent="create">
      <template v-if="!url">
        <p class="text-p-sm text-ink-gray-6">
          {{ __('Anyone with this link can access this item.') }}
        </p>
        <Select
          v-model="role"
          size="sm"
          :label="__('Access')"
          :options="roles"
          :disabled="pending"
        />
        <DatePicker
          v-model="expiry"
          size="sm"
          :label="__('Expiry date')"
          :placeholder="__('No expiry date')"
          :disabled="pending"
        >
          <template #actions="{ clear }">
            <Button
              variant="ghost"
              :label="__('No expiry date')"
              :disabled="pending"
              @click="clear"
            />
          </template>
        </DatePicker>
        <Switch
          v-model="passwordProtected"
          size="sm"
          :label="__('Password protected')"
          :disabled="pending"
        />
        <Password
          v-if="passwordProtected"
          v-model="password"
          size="sm"
          :label="__('Password')"
          :placeholder="passwordProtected ? __('Enter password') : __('No password')"
          autocomplete="new-password"
          :required="passwordProtected"
          :disabled="pending || !passwordProtected"
        />
        <ErrorMessage
          v-if="state.errors.get(NEW_LINK_ROW)"
          :message="state.errors.get(NEW_LINK_ROW)"
        />
      </template>
      <template v-else>
        <p role="status" class="text-p-sm text-ink-gray-6">{{ __('Your share link is ready.') }}</p>
        <TextInput :model-value="absoluteUrl" size="sm" :label="__('Share link')" readonly />
      </template>
    </form>
    <template #actions>
      <div class="flex justify-end gap-2">
        <template v-if="!url">
          <Button :label="__('Cancel')" :disabled="pending" @click="open = false" />
          <Button
            type="submit"
            form="create-share-link"
            variant="solid"
            :label="__('Create link')"
            :loading="pending"
            :disabled="passwordProtected && !password"
          />
        </template>
        <template v-else>
          <Button icon-left="lucide-copy" :label="__('Copy link')" @click="copyLink(url)" />
          <Button variant="solid" :label="__('Done')" @click="open = false" />
        </template>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import {
  Button,
  DatePicker,
  Dialog,
  ErrorMessage,
  Password,
  Select,
  Switch,
  TextInput,
} from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { endOfDayStamp, rolesFor } from '@/apps/drive/client/grants'
import { DRIVE_ROLES } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

import { copyLink } from './shareFormat'
import { NEW_LINK_ROW, type ShareState } from './useShare'

const props = defineProps<{ state: ShareState; nodeKind: string }>()
const open = defineModel<boolean>('open', { required: true })
const role = ref<number>(DRIVE_ROLES.read)
const expiry = ref(dayjs().add(1, 'month').format('YYYY-MM-DD'))
const passwordProtected = ref(false)
const password = ref('')
watch(passwordProtected, (enabled) => {
  if (!enabled) password.value = ''
})
const url = ref('')
const pending = computed(() => props.state.isPending(NEW_LINK_ROW))
const absoluteUrl = computed(() => new URL(url.value, window.location.origin).href)
const roles = computed(() =>
  rolesFor('link', props.nodeKind).map((role) => ({ ...role, label: __(role.label) })),
)

async function create() {
  if (pending.value || url.value || (passwordProtected.value && !password.value)) return
  const created = await props.state.newLink({
    role: role.value,
    expires_on: expiry.value ? endOfDayStamp(expiry.value) : null,
    password: passwordProtected.value ? password.value : null,
  })
  if (created) {
    password.value = ''
    url.value = created
  }
}
</script>
