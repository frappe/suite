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
import { ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useMutation } from '@/api'
import { useWorkspace } from '@/shell/useWorkspace'
import WorkspaceLogoUploader from '@/shell/WorkspaceLogoUploader.vue'

const emit = defineEmits<{ saved: [] }>()

const { workspaceName, workspaceLogo, setWorkspace } = useWorkspace()

const name = ref(workspaceName.value)
const logo = ref(workspaceLogo.value)

const canSave = computed(() => !!name.value.trim())

const saveWorkspace = useMutation(api.suite.site.updateSettings, { silent: true })

async function save() {
  if (!canSave.value || saveWorkspace.isPending) return
  try {
    const site = await saveWorkspace.run({
      workspace_name: name.value.trim(),
      workspace_logo: logo.value,
    })
    setWorkspace(site)
    emit('saved')
  } catch {
    /* The form shows the refusal inline. */
  }
}

defineExpose({
  save,
  canSave,
  saving: computed(() => saveWorkspace.isPending),
})
</script>
