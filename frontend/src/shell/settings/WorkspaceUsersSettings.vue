<template>
  <SettingsTabHeader :title="__('Users')" />
  <SettingsTabContent>
    <WorkspaceUsers />
  </SettingsTabContent>
</template>

<script setup lang="ts">
import { translate as __ } from '@/platform/translation'
import SettingsTabContent from '@/shell/settings/SettingsTabContent.vue'
import SettingsTabHeader from '@/shell/settings/SettingsTabHeader.vue'
import WorkspaceUsers from '@/shell/settings/WorkspaceUsers.vue'
</script>
