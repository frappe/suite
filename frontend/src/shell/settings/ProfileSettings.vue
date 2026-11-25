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
          variant="outline"
          class="w-full"
          autocomplete="given-name"
          @blur="saveName"
        />
        <FormControl
          v-model="nameDraft.last_name"
          :label="__('Last name')"
          variant="outline"
          class="w-full"
          autocomplete="family-name"
          @blur="saveName"
        />
      </div>

      <SettingsRow :title="__('Password')" :description="__('Manage password and account access.')">
        <Button :label="__('Change password')" @click="showPasswordDialog = true" />
      </SettingsRow>
    </div>
  </SettingsTabContent>

  <ChangePasswordDialog v-model:open="showPasswordDialog" />
</template>

<script setup lang="ts">
import {
  Avatar,
  Button,
  Dropdown,
  ErrorMessage,
  FileUploader,
  FormControl,
  SettingsRow,
  toast,
} from 'frappe-ui'
import { computed, reactive, ref, watch } from 'vue'

import { api, client, useMutation, useQuery } from '@/api'
import { useSession } from '@/platform/session'
import { onSettingsSectionAsked } from '@/platform/settings'
import { translate as __ } from '@/platform/translation'
import ChangePasswordDialog from '@/shell/settings/ChangePasswordDialog.vue'
import SettingsTabContent from '@/shell/settings/SettingsTabContent.vue'
import SettingsTabHeader from '@/shell/settings/SettingsTabHeader.vue'

const AUTOSAVE_TOAST_ID = 'suite-profile-autosave'

const session = useSession()
const userId = session.user.value?.id ?? ''

const user = useQuery(api.suite.preferences.get)
const updateUser = useMutation(api.suite.preferences.update, { silent: true })
const nameDraft = reactive({ first_name: '', last_name: '' })
// The saved name fills the fields, but not one being typed in: the other field's save brings the
// user back while it is.
watch(
  () => user.data,
  (doc, before) => {
    if (!doc) return
    for (const field of ['first_name', 'last_name'] as const) {
      if (!before || nameDraft[field] === (before[field] || '')) nameDraft[field] = doc[field] || ''
    }
  },
  { immediate: true },
)

const showPasswordDialog = ref(false)
onSettingsSectionAsked(
  () => 'account.profile.password',
  () => (showPasswordDialog.value = true),
)

const displayName = computed(() => {
  const doc = user.data
  if (!doc) return userId
  const name = [doc.first_name, doc.last_name].filter(Boolean).join(' ')
  return name || doc.email || userId
})

function avatarMenuOptions(openFileSelector: () => void) {
  return [
    {
      label: __('Change picture'),
      icon: 'lucide-image-up',
      onClick: openFileSelector,
    },
    {
      label: __('Remove picture'),
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

// Saved as a field loses focus, which leaving the page while typing in it also does: so not with
// the page's mutation, which is cancelled when the page goes. The fields stay open while it saves,
// as closing them would push the caret out of the field just moved to; a change made meanwhile is
// saved once this save is done.
let savingName = false
let nameChangedMeanwhile = false
async function saveName() {
  if (!user.data) return
  if (savingName) {
    nameChangedMeanwhile = true
    return
  }

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

  savingName = true
  try {
    await client.mutation(
      api.suite.preferences.update,
      { first_name: nextFirst, last_name: nextLast },
      { silent: true },
    )
    await session.refresh()
    toast.success(__('Name saved'), { id: AUTOSAVE_TOAST_ID })
  } catch {
    toast.error(__('Could not save name'))
  } finally {
    savingName = false
  }
  if (nameChangedMeanwhile) {
    nameChangedMeanwhile = false
    await saveName()
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
</script>
