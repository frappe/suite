<template>
  <h1 class="font-semibold mb-8 text-ink-gray-9">
    {{ __('Profile') }}
  </h1>
  <div class="flex justify-start w-full items-center gap-x-4">
    <Avatar :image="newImageUrl" size="3xl" :label="fullName" class="w-20 h-20" />
    <div class="flex flex-col">
      <span class="text-3xl-semibold text-ink-gray-8">{{ fullName }}</span>
      <span class="text-base text-ink-gray-6">{{ currentUserId }}</span>
    </div>
    <Button class="ml-auto" @click="editProfileDialog = true">
      {{ __('Edit profile') }}
    </Button>
  </div>
  <Dialog v-model:open="editProfileDialog" :title="__('Edit Profile')" size="md" :actions="[
    {
      label: __('Confirm'),
      variant: 'solid',
      onClick: updateProfile,
    },
  ]">
    <div class="flex flex-col items-start justify-start gap-y-2">
      <span class="text-base text-ink-gray-5">Profile Photo</span>
      <div class="flex items-center justify-between w-full">
        <Avatar :image="newImageUrl" size="3xl" :label="newFullName" class="w-20 h-20" />

        <div v-if="newImageUrl" class="flex items-center justify-between bg-surface-gray-2 h-7 pl-2 text-base rounded">
          <LucideLink class="mr-2 size-4" />
          <a :href="newImageUrl" class="truncate max-w-56 underline">{{ newImageUrl }}</a>

          <Button @click="newImageUrl = null">
            <template #icon>
              <LucideX class="stroke-1 h-4" />
            </template>
          </Button>
        </div>
        <FileUploader v-else file-types="image/png, image/jpeg, image/jpg" :validate-file="validateFile" @success="
          (file) => {
            newImageUrl = file.file_url
          }
        ">
          <template #default="{ openFileSelector }">
            <Button @click="openFileSelector">
              {{ __('Add Image') }}
            </Button>
          </template>
        </FileUploader>
      </div>
      <div class="w-full flex flex-col gap-y-2 my-2">
        <span class="text-base text-ink-gray-5">{{ __('First Name') }}</span>
        <Input v-model="newFirstName" autofocus />
        <span class="text-base text-ink-gray-5">{{ __('Last Name') }}</span>
        <Input v-model="newLastName" />
      </div>
    </div>
  </Dialog>
  <h1 class="font-semibold mt-12 mb-4 text-ink-gray-8">
    {{ __('Preferences') }}
  </h1>

  <Switch v-model="detectLinks" label="Automatically detect links" />
</template>
<script setup>
import {
  Button,
  Input,
  Avatar,
  Dialog,
  FileUploader,
  Switch,
  createDocumentResource,
} from 'frappe-ui'
import LucideLink from '~icons/lucide/link'
import LucideX from '~icons/lucide/x'

import { useSessionStore, useCurrentUser, userResource } from '@/boot/session'
import { ref, computed, watch } from 'vue'
import { settings, setSettings } from '@/apps/drive/resources/permissions'

const { user: _currentUser, fullName: _fullName, imageURL: _imageURL } = useCurrentUser()
const currentUserId = computed(() => _currentUser.value)
const fullName = computed(() => _fullName.value)
const newImageUrl = ref(_imageURL.value)
const newLastName = ref(fullName.value.split(' ')[1])
const newFirstName = ref(fullName.value.split(' ')[0])
const newFullName = computed(() => newFirstName.value + ' ' + newLastName.value)

const editProfileDialog = ref(false)

const detectLinks = ref(Boolean(settings.data?.auto_detect_links))
const defaultTeam = ref(settings.data.default_team || { label: '-' })
const options = {
  auto_detect_links: detectLinks,
  default_team: defaultTeam,
}
for (const k in options) {
  watch(options[k], (v) => {
    setSettings.submit({
      updates: { [k]: v.value || v },
    })
  })
}

const profile = createDocumentResource({
  doctype: 'User',
  name: currentUserId.value,
  auto: true,
})

const updateProfile = () => {
  profile.setValue
    .submit({
      first_name: newFirstName.value,
      last_name: newLastName.value,
      user_image: newImageUrl.value,
    })
    .then(() => {
      userResource.reload()
      editProfileDialog.value = false
    })
}

const validateFile = (file) => {
  const extension = file.name.split('.').pop().toLowerCase()
  if (!['jpg', 'jpeg', 'png'].includes(extension)) {
    alert('Not a valid Image file')
    return false
  }
}
</script>
