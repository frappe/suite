<template>
  <div class="flex items-start gap-4">
    <WorkspaceLogoUploader v-model="logo" />
    <div class="flex flex-1 flex-col gap-2">
      <FormControl
        v-model="name"
        type="text"
        maxlength="25"
        variant="outline"
        :label="__('Workspace name')"
        :placeholder="__('Acme Inc.')"
        @keydown.enter="save"
      />
      <ErrorMessage
        :message="saveWorkspace.error instanceof Error ? saveWorkspace.error : undefined"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { createResource, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref } from 'vue'

import { useWorkspace } from '@/shell/useWorkspace'
import WorkspaceLogoUploader from '@/shell/WorkspaceLogoUploader.vue'

const emit = defineEmits<{ saved: [] }>()

const { workspaceName, workspaceLogo, setWorkspace } = useWorkspace()

const name = ref(workspaceName.value)
const logo = ref(workspaceLogo.value)

const canSave = computed(() => !!name.value.trim())

const saveWorkspace = createResource({
  url: 'suite.api.account.update_workspace',
  onSuccess: () => {
    setWorkspace({ workspace_name: name.value.trim(), workspace_logo: logo.value })
    emit('saved')
  },
})

function save() {
  if (!canSave.value || saveWorkspace.loading) return
  saveWorkspace.submit({
    workspace_name: name.value,
    workspace_logo: logo.value,
  })
}

defineExpose({
  save,
  canSave,
  saving: computed(() => saveWorkspace.loading),
})
</script>
