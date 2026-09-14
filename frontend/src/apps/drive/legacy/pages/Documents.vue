<template>
  <GenericPage
    :get-entities="getDocuments"
    :empty="{
      icon: LucideFileText,
      title: 'No documents yet',
      description: `Use Writer to create documents.`,
    }"
  />
</template>
<script setup>
import GenericPage from '@/apps/drive/components/GenericPage.vue'
import LucideFileText from '~icons/lucide/file-text'
import { getDocuments } from '@/apps/drive/resources/files'
</script>
