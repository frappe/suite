<template>
  <div class="group relative shrink-0">
    <FileUploader
      file-types=".png,.jpg,.jpeg,.webp"
      :private="false"
      doctype="Suite Settings"
      docname="Suite Settings"
      fieldname="workspace_logo"
      :validate-file="showPicked"
      @success="onUploaded"
      @failure="clearPicked"
    >
      <template #default="{ openFileSelector, uploading, progress, error }">
        <!-- Arbitrary-value border color: the border-outline-gray-2 token is
        cascade-layered and loses here, painting the wrong color. Keep as-is. -->
        <button
          type="button"
          class="relative block size-[52px] overflow-hidden rounded-[10px] border bg-surface-base focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3 focus-visible:border-none"
          :class="[
            error ? 'border-[color:var(--ink-red-4)]' : 'border-[color:var(--outline-gray-2)]',
            !shown && 'border-dashed',
          ]"
          :title="error ?? undefined"
          :aria-busy="uploading"
          :aria-label="
            uploading
              ? __('Uploading logo, {0}%', [progress])
              : shown
                ? __('Replace logo')
                : __('Upload logo')
          "
          :disabled="uploading"
          @click="openFileSelector"
        >
          <img
            v-if="shown"
            :src="shown"
            :alt="__('Workspace logo')"
            class="size-full object-cover transition-opacity"
            :class="uploading ? 'opacity-50' : 'group-hover:opacity-75'"
          />
          <span
            v-else
            class="flex size-full items-center justify-center group-hover:bg-surface-gray-2"
          >
            <LucideImagePlus class="size-5 text-ink-gray-5" />
          </span>
        </button>
        <!-- A ring just outside the tile fills in clockwise as the upload goes; outside, so it shows on any logo. -->
        <span
          v-if="uploading"
          class="pointer-events-none absolute -inset-[4px] rounded-[14px] p-[2px]"
          :style="borderTrace(progress)"
          aria-hidden="true"
        />
      </template>
    </FileUploader>
    <!-- Shown on hover, on focus, and always on touch screens, where there is no hover. -->
    <button
      v-if="logo && !picked"
      type="button"
      class="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-surface-gray-7 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
      :aria-label="__('Remove logo')"
      @click="logo = ''"
    >
      <LucideX class="size-3" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { FileUploader } from 'frappe-ui'
import { computed, onBeforeUnmount, ref } from 'vue'

const logo = defineModel<string>({ required: true })

/** The chosen file, shown from the device while it uploads. */
const picked = ref('')
const shown = computed(() => picked.value || logo.value)

function showPicked(file: File) {
  clearPicked()
  picked.value = URL.createObjectURL(file)
  return null
}

function clearPicked() {
  if (picked.value) URL.revokeObjectURL(picked.value)
  picked.value = ''
}

function onUploaded(file: { file_url: string }) {
  logo.value = file.file_url
  clearPicked()
}

onBeforeUnmount(clearPicked)

/** A ring masked to the tile's edge, filled to `progress` percent from the top. */
function borderTrace(progress: number) {
  const edgeOnly = 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)'
  return {
    background: `conic-gradient(var(--ink-gray-8) ${progress}%, transparent 0)`,
    mask: edgeOnly,
    maskComposite: 'exclude',
    WebkitMask: edgeOnly,
    WebkitMaskComposite: 'xor',
  }
}
</script>
