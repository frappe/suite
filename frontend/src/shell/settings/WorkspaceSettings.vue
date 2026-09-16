<template>
  <AppSettingsHeader :title="__('Workspace')" />
  <AppSettingsBody>
    <div class="space-y-11 pt-6">
      <WorkspaceGeneral />
      <WorkspaceUsers />
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import WorkspaceGeneral from '@/shell/settings/WorkspaceGeneral.vue'
import WorkspaceUsers from '@/shell/settings/WorkspaceUsers.vue'
</script>
