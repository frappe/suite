<template>
  <!-- The decision a screened thread is waiting on, in the thread itself: the rest of the thread view
	     works as usual, and acting on the thread decides it too. Yes lets the sender's images in for
	     good; the images banner below loads them just this once. Two banners on desktop; on a phone,
	     two full-bleed rows. -->
  <div class="sm:space-y-2" role="region" :aria-label="__('New sender')">
    <div class="bg-surface-gray-1 flex items-center gap-3 px-3 py-2 max-sm:border-b sm:rounded-6">
      <UserRoundSearch class="text-ink-gray-5 size-4 shrink-0" />
      <div class="text-p-sm text-ink-gray-8 min-w-0 flex-1 truncate">
        {{ __('Do you want mail from') }}
        <span class="!font-medium">{{ email }}</span>?
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button variant="outline" :label="__('No')" @click="emit('deny')" />
        <!-- Yes, split: the arrow trusts everyone at the sender's domain instead. -->
        <div class="flex items-center">
          <Button
            variant="solid"
            class="!rounded-r-none"
            :label="__('Yes')"
            @click="emit('allow')"
          />
          <Dropdown
            :options="[
              {
                label: __('Mark {0} as trusted', [domain]),
                onClick: () => emit('allowDomain'),
              },
            ]"
            align="end"
          >
            <Button
              variant="solid"
              class="!rounded-l-none !px-1.5"
              style="border-left: 1px solid color-mix(in srgb, currentColor 35%, transparent)"
              :aria-label="__('More ways to say yes')"
            >
              <template #icon><ChevronDown class="size-4" /></template>
            </Button>
          </Dropdown>
        </div>
      </div>
    </div>

    <HiddenImagesBanner
      v-if="hiddenImages !== null"
      :images="hiddenImages"
      @show="emit('loadImages')"
    />
  </div>
</template>

<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'
import { ChevronDown, UserRoundSearch } from 'lucide-vue-next'
import { computed } from 'vue'

import HiddenImagesBanner from '@/apps/mail/components/HiddenImagesBanner.vue'

/** `hiddenImages`: how many remote images the thread is holding back, or null when nothing is. */
const { email, hiddenImages = null } = defineProps<{ email: string; hiddenImages?: number | null }>()
const emit = defineEmits<{ allow: []; allowDomain: []; deny: []; loadImages: [] }>()

const domain = computed(() => email.split('@').pop() ?? '')
</script>
