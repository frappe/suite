<template>
  <div
    ref="container"
    class="mx-auto w-96 sm:w-[60%] pt-8 h-screen space pb-64"
  >
    <template
      v-for="([group, files], i) in Object.entries(groups).filter(
        ([_, f]) => f.length,
      )"
      :key="group"
    >
      <div
        class="flex justify-between items-center sticky top-0 bg-surface-base h-8 z-10 mt-3 mb-1 -mx-3"
      >
        <h2 class="text-sm-medium text-ink-gray-5">
          {{ group }}
        </h2>
        <TabButtons
          v-if="i === 0"
          class="w-fit"
          v-model="thumbnail"
          :options="[
            {
              label: 'Grid',
              value: 'grid',
              icon: LucideGrid,
              hideLabel: true,
            },
            {
              label: 'List',
              value: 'list',
              icon: LucideList,
              hideLabel: true,
            },
          ]"
        />
      </div>
      <div
        :class="
          thumbnail === 'grid' &&
          'grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 !mb-0 mx-0.5'
        "
      >
        <div v-for="(row, i) in files" :key="row.name">
          <template v-if="thumbnail === 'grid'">
            <section
              class="group"
              @click="
                $router.push({ name: 'writer-document', params: { id: row.name } })
              "
            >
              <div
                class="aspect-[37/50] cursor-pointer overflow-hidden rounded-md dark:bg-gray-900 border border-gray-50 dark:border-outline-gray-1 px-2.5 py-1 shadow-lg transition-shadow hover:shadow-xl"
              >
                <div class="overflow-hidden text-ellipsis whitespace-nowrap">
                  <div
                    class="prose prose-sm prose-v3 pointer-events-none w-[200%] origin-top-left scale-[.55] prose-p:my-1 md:w-[250%] md:scale-[.39]"
                    v-html="row.html"
                  />
                </div>
              </div>
              <div class="mt-3 flex justify-between items-center">
                <div class="flex-grow w-full min-w-0">
                  <h1 class="text-base-medium truncate text-ink-gray-7">
                    {{ row.file_name }}
                  </h1>
                </div>
              </div>
            </section>
          </template>
          <template v-else>
            <div
              @click="
                $router.push({ name: 'writer-document', params: { id: row.name } })
              "
              class="group flex flex-col gap-2 md:flex-row p-3 md:items-center md:justify-between hover:bg-surface-gray-1 rounded cursor-pointer my-px -mx-3"
            >
              <p
                class="text-base-medium text-ink-gray-8 truncate md:w-1/2 overflow-clip"
              >
                {{ row.file_name }}
              </p>

              <div
                class="flex items-center justify-between gap-2 text-sm text-gray-600 flex-shrink-0"
              >
                <div
                  class="text-xs text-ink-gray-5 flex gap-2 md:gap-5 items-center"
                >
                  <LucideGlobe2
                    v-if="row.share_count == -2"
                    class="size-4 text-ink-gray-6"
                  />
                  <LucideBuilding2
                    v-else-if="row.share_count == -1"
                    class="size-4 text-ink-gray-6"
                  />
                  <LucideUsers
                    v-else-if="row.share_count > 0"
                    class="size-4 text-ink-gray-6"
                  />
                  <template v-if="row.owner === currentUserId">
                    <Avatar
                      :image="$user(row.owner)?.user_image"
                      :label="$user(row.owner)?.full_name || 'Deleted'"
                      size="xs"
                    />
                    <span :title="row.owner">
                      {{ $user(row.owner)?.full_name || 'Deleted' }}
                    </span>
                  </template>
                </div>

                <span :title="row.recentDate" class="w-28 text-end">{{
                  row.relativeModified
                }}</span>
              </div>
            </div>
            <hr v-if="i !== files.length - 1" />
          </template>
        </div>
      </div>
    </template>

    <div
      v-if="props.resource.data?.length === 0"
      class="flex flex-col items-center gap-2.5 my-10"
    >
      <div class="flex flex-col gap-1.5 items-center">
        <LucideFileText class="size-8 text-ink-gray-4" />
        <p class="text-base-medium text-ink-gray-6">
          {{ __('No documents yet.') }}
        </p>
      </div>
      <p class="text-sm text-ink-gray-5">
        {{ __('Create a document to get started.') }}
      </p>
    </div>
  </div>
  <!-- <ContextMenu
      v-if="rowEvent && selectedRow"
      :key="selectedRow.name"
      :action-items="dropdownActionItems(selectedRow)"
      :event="rowEvent"
      :close="() => (rowEvent = false)"
    /> -->
</template>

<script setup lang="ts">
import { computed, ref, watch, useTemplateRef } from 'vue'

import { Avatar, TabButtons } from 'frappe-ui'
import { useInfiniteScroll } from '@vueuse/core'
import LucideGrid from '~icons/lucide/grid'
import LucideList from '~icons/lucide/list'
import LucideGlobe2 from '~icons/lucide/globe-2'
import LucideBuilding2 from '~icons/lucide/building-2'
import LucideUsers from '~icons/lucide/users'
import LucideFileText from '~icons/lucide/file-text'
import { useSessionStore } from '@/boot/session'
import { useUsers } from '@/apps/writer/composables/useUsers'

const currentUserId = computed(() => useSessionStore().user)
const { getUser: $user } = useUsers()

const thumbnail = ref(
  JSON.parse(localStorage.getItem('writer-view') || '"list"'),
)
watch(thumbnail, (v) => localStorage.setItem('writer-view', JSON.stringify(v)))
const props = defineProps({
  groups: Object,
  resource: Object,
  actionItems: Array,
})

const container = useTemplateRef<HTMLElement>('container')
useInfiniteScroll(
  container,
  () => {
    if (props.resource.hasNextPage && !props.resource.loading) {
      props.resource.next()
    }
  },
  {
    distance: 10,
    canLoadMore: () => {
      return props.resource.hasNextPage
    },
  },
)
</script>
