<template>
  <GenericPage :get-entities="getPersonal" :empty="{
    icon: LucideHome,
    title: 'No files yet',
    description: 'Upload to get started!',
  }" :verify="!shareView && {
          data: {
            write: 1,
            upload: 1,
          },
        }
        " />
</template>

<script setup>
import GenericPage from '@/apps/drive/components/GenericPage.vue'
import { getPersonal } from '@/apps/drive/resources/files'
import { shareView } from '@/apps/drive/data/prefs'
import { setCurrentFolder } from '@/apps/drive/data/currentFolder'
import LucideHome from '~icons/lucide/home'

setCurrentFolder({ name: '', team: '' })
</script>
