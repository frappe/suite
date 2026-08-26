<template>
  <SettingsHeader>
    <h2 class="text-md-semibold text-ink-gray-8">{{ __('Workspace') }}</h2>
  </SettingsHeader>
  <SettingsBody>
    <div class="space-y-11 pt-6">
      <WorkspaceGeneral />
      <WorkspaceUsers />
    </div>
  </SettingsBody>
</template>

<script setup lang="ts">
import { SettingsBody, SettingsHeader } from 'frappe-ui'

import WorkspaceGeneral from '@/shell/settings/WorkspaceGeneral.vue'
import WorkspaceUsers from '@/shell/settings/WorkspaceUsers.vue'
</script>
