<template>
  <SettingsTabHeader :title="__('Profile')" />
  <SettingsTabContent>
    <div v-if="user.data" class="flex flex-col gap-6">
      <FileUploader
        file-types="image/png,image/jpeg,image/jpg"
        :private="false"
        :validate-file="validateAvatarFile"
        @success="onAvatarUploaded"
      >
        <template #default="{ openFileSelector, uploading, error }">
          <div class="flex items-center gap-4">
            <div>
              <Dropdown
                v-if="user.data.user_image"
                :options="avatarMenuOptions(openFileSelector)"
                align="end"
              >
                <button
                  type="button"
                  class="flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
                  :aria-label="__('Profile picture options')"
                  :disabled="uploading || updateUser.isPending"
                >
                  <Avatar
                    :image="user.data.user_image || undefined"
                    :label="displayName"
                    size="3xl"
                    class="!h-16 !w-16"
                  />
                </button>
              </Dropdown>
              <button
                v-else
                type="button"
                class="flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
                :aria-label="__('Upload profile picture')"
                :disabled="uploading || updateUser.isPending"
                @click="openFileSelector"
              >
                <Avatar
                  :image="user.data.user_image || undefined"
                  :label="displayName"
                  size="3xl"
                  class="!h-16 !w-16"
                />
              </button>
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <div class="text-xl-semibold text-ink-gray-8 truncate">
                {{ displayName }}
              </div>
              <p class="text-base text-ink-gray-6 truncate">
                {{ uploading ? __('Uploading…') : user.data.email || userId }}
              </p>
              <ErrorMessage v-if="error" :message="error" />
            </div>
          </div>
        </template>
      </FileUploader>

      <div class="grid gap-6 sm:grid-cols-2">
        <FormControl
          v-model="nameDraft.first_name"
          :label="__('First name')"
          class="w-full"
          autocomplete="given-name"
          :disabled="updateUser.isPending"
          @blur="saveName"
        />
        <FormControl
          v-model="nameDraft.last_name"
          :label="__('Last name')"
          class="w-full"
          autocomplete="family-name"
          :disabled="updateUser.isPending"
          @blur="saveName"
        />
      </div>

      <SettingsRow :title="__('Password')" :description="__('Manage password and account access')">
        <Button :label="__('Update password')" @click="showPasswordDialog = true" />
      </SettingsRow>
    </div>
  </SettingsTabContent>

  <Dialog v-model:open="showPasswordDialog" v-bind="passwordDialogOptions">
    <template #default>
      <form class="space-y-4" @submit.prevent>
        <!-- Capture username here so Chrome doesn't fill profile last name -->
        <input
          type="text"
          name="username"
          autocomplete="username"
          tabindex="-1"
          aria-hidden="true"
          :value="userId || ''"
          readonly
          class="pointer-events-none absolute h-0 w-0 opacity-0"
        />
        <FormControl
          v-model="currentPassword"
          type="password"
          name="current-password"
          autocomplete="current-password"
          :label="__('Current password')"
          placeholder="••••••••"
        />
        <FormControl
          v-model="newPassword"
          type="password"
          name="new-password"
          autocomplete="new-password"
          :label="__('New password')"
          placeholder="••••••••"
        />
        <FormControl
          v-model="confirmPassword"
          type="password"
          name="confirm-password"
          autocomplete="new-password"
          :label="__('Confirm new password')"
          placeholder="••••••••"
        />
        <ErrorMessage :message="passwordError" />
      </form>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import {
  Avatar,
  Button,
  Dialog,
  Dropdown,
  ErrorMessage,
  FileUploader,
  FormControl,
  SettingsRow,
  toast,
} from 'frappe-ui'
import { computed, reactive, ref, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import SettingsTabContent from '@/shell/settings/SettingsTabContent.vue'
import SettingsTabHeader from '@/shell/settings/SettingsTabHeader.vue'

const AUTOSAVE_TOAST_ID = 'suite-profile-autosave'

const session = useSession()
const userId = session.user.value?.id ?? ''

const user = useQuery(api.suite.preferences.get)
const updateUser = useMutation(api.suite.preferences.update, { silent: true })
const nameDraft = reactive({ first_name: '', last_name: '' })
watch(
  () => user.data,
  (doc) => {
    if (doc)
      Object.assign(nameDraft, { first_name: doc.first_name || '', last_name: doc.last_name || '' })
  },
  { immediate: true },
)

const showPasswordDialog = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

const displayName = computed(() => {
  const doc = user.data
  if (!doc) return userId
  const name = [doc.first_name, doc.last_name].filter(Boolean).join(' ')
  return name || doc.email || userId
})

function avatarMenuOptions(openFileSelector: () => void) {
  return [
    {
      label: __('Change image'),
      icon: 'lucide-image-up',
      onClick: openFileSelector,
    },
    {
      label: __('Remove image'),
      icon: 'lucide-trash-2',
      onClick: removeAvatar,
    },
  ]
}

function validateAvatarFile(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !['png', 'jpg', 'jpeg'].includes(ext)) {
    return __('Only PNG and JPG images are allowed')
  }
}

async function saveName() {
  if (!user.data || updateUser.isPending) return

  const nextFirst = nameDraft.first_name.trim()
  const nextLast = nameDraft.last_name.trim()
  if (!nextFirst) {
    toast.error(__('First name is required'))
    nameDraft.first_name = user.data?.first_name || ''
    return
  }

  const prevFirst = user.data?.first_name || ''
  const prevLast = user.data?.last_name || ''
  if (nextFirst === prevFirst && nextLast === prevLast) return

  try {
    await updateUser.run({
      first_name: nextFirst,
      last_name: nextLast,
    })
    await session.refresh()
    toast.success(__('Name saved'), { id: AUTOSAVE_TOAST_ID })
  } catch {
    toast.error(__('Could not save name'))
  }
}

async function onAvatarUploaded(file: { file_url: string }) {
  if (!user.data) return
  try {
    await updateUser.run({ user_image: file.file_url })
    await session.refresh()
    toast.success(__('Profile picture updated'), { id: AUTOSAVE_TOAST_ID })
  } catch {
    toast.error(__('Could not update profile picture'))
  }
}

async function removeAvatar() {
  if (!user.data?.user_image || updateUser.isPending) return
  try {
    await updateUser.run({ user_image: null })
    await session.refresh()
    toast.success(__('Profile picture removed'), { id: AUTOSAVE_TOAST_ID })
  } catch {
    toast.error(__('Could not remove profile picture'))
  }
}

const passwordError = computed(() => {
  if (confirmPassword.value && confirmPassword.value !== newPassword.value)
    return __('Passwords do not match')
  const error: unknown = updatePassword.error
  return error instanceof Error ? error : undefined
})

const passwordDialogOptions = computed(() => ({
  title: __('Change password'),
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      onClick: () => changePassword(),
      disabled:
        !(currentPassword.value.length && newPassword.value.length) ||
        confirmPassword.value !== newPassword.value,
      loading: updatePassword.isPending,
    },
  ],
}))

const updatePassword = useMutation(api.suite.account.changePassword)
async function changePassword() {
  await updatePassword.run({
    old_password: currentPassword.value,
    new_password: newPassword.value,
  })
  showPasswordDialog.value = false
  toast.success(__('Password updated.'))
}

watch(showPasswordDialog, (open) => {
  if (!open) {
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    updatePassword.reset()
  }
})
</script>
