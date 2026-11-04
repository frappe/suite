<template>
  <SettingsTabHeader :title="__('General')" />
  <SettingsTabContent>
    <WorkspaceGeneral />
  </SettingsTabContent>
</template>

<script setup lang="ts">
import { translate as __ } from '@/platform/translation'
import SettingsTabContent from '@/shell/settings/SettingsTabContent.vue'
import SettingsTabHeader from '@/shell/settings/SettingsTabHeader.vue'
import WorkspaceGeneral from '@/shell/settings/WorkspaceGeneral.vue'
</script>
