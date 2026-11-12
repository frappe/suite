<template>
  <Dialog
    v-model:open="showThemeDialog"
    size="2xl"
    :title="dialogTitle"
    :dismissible="update"
    :show-close-button="update"
  >
    <div class="flex flex-col gap-5">
      <p class="text-p-base text-ink-gray-7">{{ dialogDescription }}</p>
      <div class="-m-1 no-scrollbar grid max-h-[32rem] grid-cols-2 gap-6 overflow-y-auto p-1">
        <div v-for="theme in templateList" :key="theme.name" class="flex flex-col gap-3">
          <div
            class="aspect-video cursor-pointer overflow-hidden rounded-6 border border-outline-gray-1 hover:border-outline-gray-2"
            :class="getThemeThumbnailClasses(theme.name)"
            :style="getThemeThumbnailStyles(theme)"
            @click="performAction(theme.name)"
          >
            <SlidePreview
              v-if="shouldRenderPreview(theme)"
              :slide="getThemePreviewLayout(theme)"
              :scale="THEME_PREVIEW_SCALE"
            />
          </div>
          <div class="flex items-center justify-between">
            <div class="select-none text-base text-ink-gray-7">
              {{ theme.title }}
            </div>
            <LucideCheck
              v-if="props.update && theme.name == presentationTheme"
              class="size-4 stroke-[1.5] text-ink-gray-8"
            />
          </div>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog } from 'frappe-ui'
import { computed } from 'vue'

import type { GetTemplatesOutputTemplate } from '@/apps/slides/client/generated'
import SlidePreview from '@/apps/slides/components/SlidePreview.vue'
import { presentationTheme, templateList } from '@/apps/slides/stores/presentation'
import { getThumbnailCardStyles } from '@/apps/slides/utils/helpers'

type Theme = GetTemplatesOutputTemplate

// card width: 2xl dialog (672) - px-6 (48) - gap-6 (24), halved
const THEME_PREVIEW_SCALE = 300 / 960

const props = defineProps({
  update: {
    type: Boolean,
    default: false,
  },
})

const showThemeDialog = defineModel<boolean>('open', { required: true })

const emit = defineEmits(['create', 'update'])

const dialogTitle = computed(() => (props.update ? 'Set theme' : 'Select theme'))
const dialogDescription = computed(() =>
  props.update
    ? 'Update the theme for this presentation. All newly added slides will use this theme.'
    : 'Select a theme for your new presentation. You can change this theme later.',
)

const performAction = (theme: string) => {
  if (props.update) {
    emit('update', theme)
  } else {
    emit('create', theme)
  }
}

const getThemeThumbnailClasses = (theme: string) => {
  return props.update && theme == presentationTheme.value
    ? 'ring-2 ring-offset-1 ring-outline-gray-2'
    : ''
}

const getThemePreviewLayout = (theme: Theme) => {
  const thumbnailIdx = ['Light', 'Dark'].includes(theme.title) ? 2 : 0
  return theme.layouts[thumbnailIdx] || theme.layouts[0]
}

const getThemeThumbnailStyles = (theme: Theme) => {
  const layout = getThemePreviewLayout(theme)
  return {
    ...getThumbnailCardStyles(typeof layout?.thumbnail === 'string' ? layout.thumbnail : ''),
    '--tw-ring-offset-color': 'var(--surface-base)',
  }
}

const shouldRenderPreview = (theme: Theme) => {
  const layout = getThemePreviewLayout(theme)
  return layout && !layout.thumbnail
}
</script>
