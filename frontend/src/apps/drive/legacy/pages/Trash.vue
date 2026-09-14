<template>
  <GenericPage
    :get-entities="getTrash"
    :empty="{
      icon: LucideTrash,
      title: 'Trash is empty',
      description: 'Trashed files will show up here - you can restore them.',
    }"
  />
</template>

<script setup>
import GenericPage from '@/apps/drive/legacy/components/GenericPage.vue'
import { getTrash } from '@/apps/drive/legacy/resources/files'
import LucideTrash from '~icons/lucide/trash'
</script>
