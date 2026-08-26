<template>
  <FileUploader
    file-types="image/png,image/jpeg,image/jpg,image/webp"
    :private="false"
    doctype="Suite Settings"
    docname="Suite Settings"
    fieldname="workspace_logo"
    @success="(file) => (logo = file.file_url)"
  >
    <template #default="{ openFileSelector, uploading, error }">
      <div class="flex items-center gap-4">
        <div>
          <Dropdown v-if="logo" :options="logoMenuOptions(openFileSelector)">
            <button
              type="button"
              class="flex rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
              :aria-label="__('Workspace logo options')"
              :disabled="uploading || saveWorkspace.loading"
            >
              <Avatar :image="logo" :label="name" shape="square" size="3xl" class="!h-16 !w-16" />
            </button>
          </Dropdown>
          <button
            v-else
            type="button"
            class="flex rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
            :aria-label="__('Upload workspace logo')"
            :disabled="uploading || saveWorkspace.loading"
            @click="openFileSelector"
          >
            <Avatar :image="logo" :label="name" shape="square" size="3xl" class="!h-16 !w-16" />
          </button>
        </div>
        <div class="flex min-w-0 flex-1 flex-col">
          <div class="relative -ms-1.5">
            <input
              v-model="name"
              type="text"
              maxlength="20"
              class="w-full rounded-4 border border-transparent bg-transparent hover:border-outline-gray-2 ps-1.5 pe-6 py-1 text-xl-semibold text-ink-gray-8 placeholder-ink-gray-4 focus:border-outline-gray-4 focus:shadow-sm focus:outline-none focus:ring-0"
              :placeholder="__('Acme Inc.')"
              :disabled="saveWorkspace.loading"
              @blur="saveName"
              @keydown.enter="($event.target as HTMLInputElement).blur()"
            />
            <div class="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-2">
              <span class="lucide-pencil-line size-4 text-ink-gray-6" />
            </div>
          </div>
          <p class="text-base text-ink-gray-6 truncate">
            {{ uploading ? __('Uploading…') : host }}
          </p>
          <ErrorMessage v-if="error" :message="error" />
        </div>
      </div>
    </template>
  </FileUploader>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Avatar, Dropdown, ErrorMessage, FileUploader, createResource, toast } from 'frappe-ui'

import { useWorkspace } from '@/shell/useWorkspace'

const AUTOSAVE_TOAST_ID = 'suite-workspace-autosave'

const { workspaceName, workspaceLogo, setWorkspace } = useWorkspace()

const name = ref(workspaceName.value)
const logo = ref(workspaceLogo.value)
const host = window.location.host

function logoMenuOptions(openFileSelector: () => void) {
  return [
    {
      label: __('Change logo'),
      icon: 'lucide-image-up',
      onClick: openFileSelector,
    },
    {
      label: __('Remove logo'),
      icon: 'lucide-trash-2',
      onClick: () => (logo.value = ''),
    },
  ]
}

const saveWorkspace = createResource({ url: 'suite.api.account.update_workspace' })

async function save(message: string) {
  const nextName = name.value.trim()
  try {
    await saveWorkspace.submit({ workspace_name: nextName, workspace_logo: logo.value })
    setWorkspace({ workspace_name: nextName, workspace_logo: logo.value })
    toast.success(message, { id: AUTOSAVE_TOAST_ID })
  } catch {
    logo.value = workspaceLogo.value
    toast.error(__('Could not save workspace'))
  }
}

function saveName() {
  const next = name.value.trim()
  if (!next) {
    toast.error(__('Workspace name is required'))
    name.value = workspaceName.value
    return
  }
  if (next === workspaceName.value) return
  save(__('Workspace name saved'))
}

watch(logo, (next) => {
  if (next === workspaceLogo.value) return
  save(next ? __('Logo updated') : __('Logo removed'))
})
</script>
