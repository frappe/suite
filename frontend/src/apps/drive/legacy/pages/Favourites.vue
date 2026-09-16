<template>
  <GenericPage
    :get-entities="getFavourites"
    :empty="{
      icon: LucideStar,
      title: 'No favourites yet',
      description: 'You can save your favourites here.',
    }"
  />
</template>

<script setup>
import GenericPage from '@/apps/drive/legacy/components/GenericPage.vue'
import { getFavourites } from '@/apps/drive/legacy/resources/files'
import LucideStar from '~icons/lucide/star'
</script>
