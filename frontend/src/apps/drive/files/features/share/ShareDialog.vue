<!--
  The one Drive share dialog (unified spec §7). The Drive area and every
  document surface open it through `useDriveDialogs().share()` or
  `session.share()`. On phone it opens as a bottom sheet with the same body.
-->
<template>
  <BottomSheet v-if="isPhone" :open="open" :title="heading" @update:open="open = $event" @after-leave="emit('after-leave')">
    <div class="space-y-5 px-4 pb-8">
      <ShareBody v-model:picking="picking" :state="state" />
      <div class="flex items-center gap-2">
        <Button v-if="address" icon-left="lucide-link" label="Copy link" @click="copyLink(address)" />
        <Button class="ml-auto" :variant="picking ? 'subtle' : 'solid'" label="Done" @click="open = false" />
      </div>
    </div>
  </BottomSheet>
  <Dialog v-else v-model:open="open" :title="heading" size="xl" @after-leave="emit('after-leave')">
    <!-- Sized to its content; a long list scrolls inside, under the header and the actions. -->
    <div class="-mx-1 max-h-[min(36rem,calc(100dvh_-_16rem))] overflow-y-auto px-1">
      <ShareBody v-model:picking="picking" :state="state" autofocus-picker />
    </div>
    <template #actions>
      <div class="flex items-center gap-2">
        <Button v-if="address" icon-left="lucide-link" label="Copy link" @click="copyLink(address)" />
        <Button class="ml-auto" :variant="picking ? 'subtle' : 'solid'" label="Done" @click="open = false" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { BottomSheet, Button, Dialog } from 'frappe-ui'
import { useMediaQuery } from '@vueuse/core'

import { confirm } from '@/platform/feedback'
import { query, useQuery } from '@/platform/server-state'
import { useSession } from '@/platform/session'
import { api as suiteApi } from '@/platform/transport/generated'

import { useLocationTitle } from '../../internal/locations'
import { slugify } from '../../internal/slugify'
import ShareBody from './ShareBody.vue'
import { copyLink } from './shareFormat'
import { useShare } from './useShare'

const props = defineProps<{ node: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ 'after-leave': []; changed: [value: boolean] }>()

const isPhone = useMediaQuery('(max-width: 767px)')
// While people wait to be added, Share is the one solid action.
const picking = ref(false)
const session = useSession()
// The server page boots the workspace name. The Vite dev page does not, so the dialog asks the site.
const site = useQuery(() => (window.suite_workspace_name === undefined ? query(suiteApi.site_get, {}) : false))
const state = useShare(props.node, {
  me: session.user.value?.id,
  confirmLoss: () =>
    confirm({
      title: 'Change your own access?',
      message: 'You will no longer be able to share this item.',
      confirmLabel: 'Change',
      destructive: true,
    }),
  workspace: () => window.suite_workspace_name ?? site.data?.workspace_name,
  placeTitle: useLocationTitle(),
})
const heading = computed(() => (state.node.value ? `Share “${state.node.value.title}”` : 'Share'))

/** The item's own address. It opens for people with access; Share links reach anyone. */
const address = computed(() => {
  const current = state.node.value
  if (!current) return null
  const base = current.kind === 'folder' || current.kind === 'root' ? '/drive/f' : '/d'
  const slug = slugify(current.title)
  return `${base}/${encodeURIComponent(current.name)}${slug ? `/${slug}` : ''}`
})

onMounted(() => void state.load())
// The opener refreshes what it shows when a write went through.
watch(state.changed, (value) => value && emit('changed', true))
</script>
