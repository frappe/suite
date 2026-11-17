<!--
  Account > Profile: the photo and name other people see. The photo saves as
  soon as it changes; the two name fields save together with Save.
-->
<template>
  <SettingsPage
    :description="__('Your photo and name, as other people see them')"
    :loading="!user.data"
    :reads="[user]"
  >
    <SettingsSection v-if="user.data">
      <!-- One child, so the section draws no line between photo and name. -->
      <div class="flex flex-col gap-6">
        <FileUploader
          file-types="image/png,image/jpeg,image/jpg"
          :private="false"
          :validate-file="validateAvatarFile"
          @success="onAvatarUploaded"
        >
          <template #default="{ openFileSelector, uploading, error }">
            <div class="flex items-center gap-3 sm:gap-4">
              <Avatar
                :image="user.data.user_image ?? undefined"
                :label="displayName"
                size="3xl"
                class="!size-12 shrink-0 sm:!size-16"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <div class="truncate text-xl-semibold text-ink-gray-8">{{ displayName }}</div>
                <p class="truncate text-base text-ink-gray-6">
                  {{ uploading ? __('Uploading…') : user.data.email }}
                </p>
                <ErrorMessage v-if="error" :message="error" />
              </div>
              <Dropdown
                v-if="user.data.user_image"
                :options="avatarMenuOptions(openFileSelector)"
                align="end"
              >
                <Button
                  class="shrink-0"
                  :label="__('Change photo')"
                  icon-right="lucide-chevron-down"
                  :disabled="uploading || updateUser.isPending"
                />
              </Dropdown>
              <Button
                v-else
                class="shrink-0"
                :label="__('Add photo')"
                :disabled="uploading || updateUser.isPending"
                @click="openFileSelector"
              />
            </div>
          </template>
        </FileUploader>

        <SettingsForm v-if="nameDraft" :dirty="nameDirty" :save="saveName">
          <div class="grid gap-4 sm:grid-cols-2">
            <FormControl
              v-model="nameDraft.first_name"
              :label="__('First name')"
              autocomplete="given-name"
              required
            />
            <FormControl
              v-model="nameDraft.last_name"
              :label="__('Last name')"
              autocomplete="family-name"
            />
          </div>
        </SettingsForm>
      </div>
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { Avatar, Button, ErrorMessage, FileUploader, FormControl } from 'frappe-ui'
import { computed } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import { Dropdown, toast } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import {
  SettingsForm,
  SettingsPage,
  SettingsSection,
  useSettingsDraft,
} from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const AUTOSAVE_TOAST_ID = 'suite-profile-autosave'

const session = useSession()

const user = useQuery(api.suite.preferences.get)
const updateUser = useMutation(api.suite.preferences.update, { silent: true })

const { draft: nameDraft, dirty: nameDirty } = useSettingsDraft(() =>
  user.data
    ? { first_name: user.data.first_name || '', last_name: user.data.last_name || '' }
    : null,
)

const displayName = computed(() => {
  const doc = user.data
  if (!doc) return ''
  return [doc.first_name, doc.last_name].filter(Boolean).join(' ') || doc.email
})

function avatarMenuOptions(openFileSelector: () => void) {
  return [
    { label: __('Upload new photo'), icon: 'lucide-image-up', onClick: openFileSelector },
    { label: __('Remove photo'), icon: 'lucide-trash-2', onClick: removeAvatar },
  ]
}

function validateAvatarFile(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !['png', 'jpg', 'jpeg'].includes(ext)) {
    return __('Only PNG and JPG images are allowed')
  }
}

async function saveName() {
  const draft = nameDraft.value
  if (!draft) return
  const first_name = draft.first_name.trim()
  if (!first_name) {
    toast.error(__('First name is required'))
    return
  }
  // Trimmed in the draft too, so it matches the saved name when the profile reloads.
  Object.assign(draft, { first_name, last_name: draft.last_name.trim() })
  try {
    await updateUser.run({ first_name, last_name: draft.last_name })
    await session.refresh()
    toast.success(__('Name saved'))
  } catch {
    toast.error(__('Could not save name'))
  }
}

async function onAvatarUploaded(file: { file_url: string }) {
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
