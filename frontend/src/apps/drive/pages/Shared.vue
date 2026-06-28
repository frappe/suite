<template>
  <GenericPage :get-entities :empty />
</template>

<script setup>
import GenericPage from '@/apps/drive/components/GenericPage.vue'
import { computed } from 'vue'
import { getSiteFiles, getShared } from '@/apps/drive/resources/files'
import { shareView } from '@/apps/drive/data/prefs'
import LucideFiles from '~icons/lucide/files'


const getEntities = computed(() =>
  shareView.value ? getShared : getSiteFiles
)
const empty = computed(() =>
  shareView.value
    ? {
      icon: LucideUsers,
      title: 'No shared files',
      description: 'You can share files easily on Drive - try it out!',
    }
    : {
      icon: LucideFiles,
      title: 'No files on site yet',
      description: 'Upload to get started!',
    }
)
</script>
