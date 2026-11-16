<!--
  Account > Profile: the photo and name other people see. The photo saves as
  soon as it changes; the two name fields save together with Save.
-->
<template>
  <SettingsPage
    :title="__('Profile')"
    :description="__('Your photo and name, as other people see them')"
    :loading="!user.data"
  >
    <template v-if="user.data">
      <SettingsSection>
        <FileUploader
          file-types="image/png,image/jpeg,image/jpg"
          :private="false"
          :validate-file="validateAvatarFile"
          @success="onAvatarUploaded"
        >
          <template #default="{ openFileSelector, uploading, error }">
            <div class="flex items-center gap-4">
              <Dropdown
                v-if="user.data.user_image"
                :options="avatarMenuOptions(openFileSelector)"
                align="start"
              >
                <button
                  type="button"
                  class="flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
                  :aria-label="__('Profile picture options')"
                  :disabled="uploading || updateUser.isPending"
                >
                  <Avatar
                    :image="user.data.user_image"
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
                <Avatar :label="displayName" size="3xl" class="!h-16 !w-16" />
              </button>
              <div class="flex min-w-0 flex-col gap-1">
                <div class="truncate text-xl-semibold text-ink-gray-8">{{ displayName }}</div>
                <p class="truncate text-base text-ink-gray-6">
                  {{ uploading ? __('Uploading…') : user.data.email }}
                </p>
                <ErrorMessage v-if="error" :message="error" />
              </div>
            </div>
          </template>
        </FileUploader>
      </SettingsSection>

      <SettingsSection :title="__('Name')">
        <SettingsForm :dirty="nameDirty" :save="saveName">
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
      </SettingsSection>
    </template>
  </SettingsPage>
</template>

<script setup lang="ts">
import { Avatar, ErrorMessage, FileUploader, FormControl } from 'frappe-ui'
import { computed, reactive, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import { Dropdown, toast } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { SettingsForm, SettingsPage, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const AUTOSAVE_TOAST_ID = 'suite-profile-autosave'

const session = useSession()

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
const nameDirty = computed(
  () =>
    nameDraft.first_name.trim() !== (user.data?.first_name || '') ||
    nameDraft.last_name.trim() !== (user.data?.last_name || ''),
)

const displayName = computed(() => {
  const doc = user.data
  if (!doc) return ''
  return [doc.first_name, doc.last_name].filter(Boolean).join(' ') || doc.email
})

function avatarMenuOptions(openFileSelector: () => void) {
  return [
    { label: __('Change image'), icon: 'lucide-image-up', onClick: openFileSelector },
    { label: __('Remove image'), icon: 'lucide-trash-2', onClick: removeAvatar },
  ]
}

function validateAvatarFile(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !['png', 'jpg', 'jpeg'].includes(ext)) {
    return __('Only PNG and JPG images are allowed')
  }
}

async function saveName() {
  const first_name = nameDraft.first_name.trim()
  if (!first_name) {
    toast.error(__('First name is required'))
    return
  }
  try {
    await updateUser.run({ first_name, last_name: nameDraft.last_name.trim() })
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
