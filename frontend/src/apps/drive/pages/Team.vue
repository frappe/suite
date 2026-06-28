<template>
  <GenericPage
    :get-entities="getTeam"
    :icon="LucideBuilding2"
    :empty="{
      title: 'This team is empty',
      description: 'Add files by dropping them here.',
    }"
    :verify="{
      data: {
        write,
        upload: write,
      },
    }"
  />
</template>

<script setup>
import GenericPage from '@/apps/drive/components/GenericPage.vue'
import { getTeam, getTeams, getPublicTeams } from '@/apps/drive/resources/files'
import { useSessionStore } from '@/boot/session'
import { setPageBreadcrumbs } from '@/apps/drive/data/breadcrumbs'
import { setCurrentFolder } from '@/apps/drive/data/currentFolder'
import { useRoute } from 'vue-router'
import LucideBuilding2 from '~icons/lucide/building-2'
import { computed, watch } from 'vue'

const props = defineProps({
  team: String,
})
watch(
  () => props.team,
  (team) => setCurrentFolder({ name: '', team: team || '' }),
  { immediate: true },
)

const route = useRoute()
const teamData = computed(
  () => getTeams.data?.[route.params?.team] || getPublicTeams.data?.[route.params?.team]
)
const write = computed(
  () =>
    teamData.value?.users?.find((k) => k.user === useSessionStore().user)
      ?.access_level > 0
)
watch(() => getPublicTeams.data, console.log)
if (!getPublicTeams.data) getPublicTeams.fetch()
watch(
  teamData,
  (t) =>
    t &&
    setPageBreadcrumbs([
      {
        label: t.title,
        name: t.name,
      },
    ]),
  { immediate: true }
)
</script>
