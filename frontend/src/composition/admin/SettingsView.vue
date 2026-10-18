<template>
  <DashboardLayout area="admin" :breadcrumbs="[{ label: __('Business settings') }]">
    <WorkspaceGeneral />
  </DashboardLayout>
</template>

<script setup lang="ts">
import { DashboardLayout } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'
import WorkspaceGeneral from '@/shell/settings/WorkspaceGeneral.vue'
</script>
