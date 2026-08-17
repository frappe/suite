<template>
  <div class="group relative shrink-0">
    <FileUploader
      file-types=".png,.jpg,.jpeg,.webp"
      :private="false"
      doctype="Suite Settings"
      docname="Suite Settings"
      fieldname="workspace_logo"
      @success="(file) => (logo = file.file_url)"
    >
      <template #default="{ openFileSelector }">
        <!-- Arbitrary-value border color: the border-outline-gray-2 token is
        cascade-layered and loses here, painting the wrong color. Keep as-is. -->
        <button
          type="button"
          class="relative block size-[52px] overflow-hidden rounded-[10px] border border-[color:var(--outline-gray-2)] bg-surface-base
            focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3 focus-visible:border-none"
          :class="!logo && 'border-dashed'"
          :aria-label="logo ? __('Replace logo') : __('Upload logo')"
          @click="openFileSelector"
        >
          <template v-if="logo">
            <img :src="logo" :alt="__('Workspace logo')" class="size-full object-cover" />
            <span
              class="absolute inset-0 hidden items-center justify-center bg-surface-base/30 group-hover:flex"
            >
              <LucideImagePlus class="size-5 text-ink-gray-6" />
            </span>
          </template>
          <span
            v-else
            class="flex size-full items-center justify-center group-hover:bg-surface-gray-2"
          >
            <LucideImagePlus class="size-5 text-ink-gray-5" />
          </span>
        </button>
      </template>
    </FileUploader>
    <button
      v-if="logo"
      type="button"
      class="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-surface-gray-7 text-white
        opacity-0 group-hover:opacity-100 focus:opacity-100
        focus:outline-none focus-visible:ring-2 focus-visible:ring-outline-gray-3"
      :aria-label="__('Remove logo')"
      @click="logo = ''"
    >
      <LucideX class="size-3" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { FileUploader } from 'frappe-ui'

const logo = defineModel<string>({ required: true })

</script>
