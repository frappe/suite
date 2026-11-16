<template>
  <div class="flex items-center gap-4">
    <WorkspaceLogoUploader v-model="logo" />
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- The hidden copy sizes the field to its text, so the pencil sits beside the name;
      size="1" drops the input's default 20-character width, which would win otherwise. -->
      <div class="relative -ms-1.5 inline-grid max-w-full self-start">
        <span
          class="invisible col-start-1 row-start-1 whitespace-pre border border-transparent ps-1.5 pe-7 py-1 text-xl-semibold"
          aria-hidden="true"
          >{{ name || __('Acme Inc.') }}</span
        >
        <input
          v-model="name"
          type="text"
          size="1"
          maxlength="20"
          class="col-start-1 row-start-1 w-full min-w-0 rounded-4 border border-transparent bg-transparent hover:border-outline-gray-2 ps-1.5 pe-7 py-1 text-xl-semibold text-ink-gray-8 placeholder-ink-gray-4 focus:border-outline-gray-4 focus:shadow-sm focus:outline-none focus:ring-0"
          :placeholder="__('Acme Inc.')"
          :disabled="saveWorkspace.isPending"
          @blur="saveName"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
        <div class="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-2">
          <span class="lucide-pencil-line size-4 text-ink-gray-6" />
        </div>
      </div>
      <p class="text-base text-ink-gray-6 truncate">{{ host }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toast } from 'frappe-ui'
import { ref, watch } from 'vue'

import { api, useMutation } from '@/api'
import { useWorkspace } from '@/platform/workspace'
import WorkspaceLogoUploader from '@/shell/WorkspaceLogoUploader.vue'

const AUTOSAVE_TOAST_ID = 'suite-workspace-autosave'

const { workspaceName, workspaceLogo, setWorkspace } = useWorkspace()

const name = ref(workspaceName.value)
const logo = ref(workspaceLogo.value)
const host = window.location.host

const saveWorkspace = useMutation(api.suite.site.updateSettings, { silent: true })

async function save(message: string) {
  const nextName = name.value.trim()
  try {
    await saveWorkspace.run({ workspace_name: nextName, workspace_logo: logo.value })
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
