<template>
  <div v-if="cropElement">
    <div :style="ghostFrameStyles">
      <div :style="contentBoxStyles">
        <img :src="getAttachmentUrl(cropElement.src)" :style="fadedImageStyles" />
        <div :style="brightWindowStyles">
          <img :src="getAttachmentUrl(cropElement.src)" :style="imageBoxStyles" />
        </div>
      </div>
    </div>
    <div ref="controlsFrame" :style="controlsFrameStyles">
      <div :style="windowStyles" @mousedown.stop="startPan" @dblclick.stop="commitCrop">
        <CropHandle
          v-for="handle in HANDLES"
          :key="handle"
          :handle="handle"
          @mousedown.stop="startResize($event, handle)"
        />
      </div>
    </div>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, onDeactivated, useTemplateRef } from 'vue'

import CropHandle from '@/apps/slides/components/CropHandle.vue'
import { useCropExit } from '@/apps/slides/composables/useCropExit'
import { useCropPan } from '@/apps/slides/composables/useCropPan'
import { useCropResize } from '@/apps/slides/composables/useCropResize'
import { cancelCrop, commitCrop, cropElement, draftCrop } from '@/apps/slides/stores/imageCrop'
import { interactionOffset } from '@/apps/slides/stores/interaction'
import { slideBounds } from '@/apps/slides/stores/slide'
import { selectionColor } from '@/apps/slides/utils/constants'
import { getBorderInset, getCroppedImageBox } from '@/apps/slides/utils/cropGeometry'
import { getAttachmentUrl } from '@/apps/slides/utils/mediaUploads'

const HANDLES = [
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
]

const GHOST_OPACITY = 0.4

const controlsFrame = useTemplateRef('controlsFrame')

// mid-session the frame carries the uncommitted offset, like SlideElement
const getFrameStyles = (zIndex) => {
  const el = cropElement.value
  return {
    position: 'absolute',
    left: `${el.left + interactionOffset.left}px`,
    top: `${el.top + interactionOffset.top}px`,
    width: `${el.width + interactionOffset.width}px`,
    height: `${el.height + interactionOffset.height}px`,
    // unconditional like SlideElement: a transform skips pixel snapping, so
    // omitting it at rotation 0 would land the overlay half a pixel off
    transform: `rotate(${el.rotation || 0}deg)`,
    transformOrigin: 'center center',
    zIndex,
    pointerEvents: 'none',
  }
}

const ghostFrameStyles = computed(() => getFrameStyles(10000))

const controlsFrameStyles = computed(() => getFrameStyles(10001))

const borderInset = computed(() => getBorderInset(cropElement.value))

const contentBoxStyles = computed(() => ({
  position: 'absolute',
  inset: `${borderInset.value}px`,
  transform: `scale(${cropElement.value.invertX || 1}, ${cropElement.value.invertY || 1})`,
}))

const imageBoxStyles = computed(() => {
  const box = getCroppedImageBox(draftCrop.value, { width: 100, height: 100 })
  return {
    position: 'absolute',
    left: `${box.left}%`,
    top: `${box.top}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
    // preflight clamps img to max-width 100%
    maxWidth: 'none',
  }
})

// the full image, washed out across its whole extent
const fadedImageStyles = computed(() => ({
  ...imageBoxStyles.value,
  opacity: GHOST_OPACITY,
}))

// clips an identically placed second copy, so the window shows the image bright
const brightWindowStyles = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
}

const windowStyles = computed(() => ({
  position: 'absolute',
  inset: `${borderInset.value}px`,
  // outline, not border: it takes no layout space, so the handles stay put
  outline: `${selectionColor} dashed ${1.5 / slideBounds.scale}px`,
  // pull the outline in so it straddles the edge, centered like the handles
  outlineOffset: `-${0.75 / slideBounds.scale}px`,
  cursor: 'move',
  pointerEvents: 'auto',
}))

const { startPan } = useCropPan(borderInset)

const { startResize } = useCropResize(borderInset)

useCropExit(controlsFrame)

onBeforeUnmount(cancelCrop)

onDeactivated(cancelCrop)
</script>
