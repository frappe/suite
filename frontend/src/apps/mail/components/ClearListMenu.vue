<template>
  <!-- Clearing what the list shows in one go, on its own toolbar: an Inbox tab, or a whole folder.
       Drawn as the toolbar's own buttons are. On a phone, whose Inbox has no View menu, an Inbox's
       menu also turns its categories on and off, and leads to a sheet of its own to choose which
       show. A phone opens it as a sheet from the bottom. -->
  <AdaptiveDropdown :options="options" align="end">
    <!-- No tooltip on a phone: a tap opens the sheet, and a tooltip only lingers over it. -->
    <Button
      variant="ghost"
      class="touch-target"
      :tooltip="isMobile ? undefined : __('More')"
      :aria-label="__('More')"
    >
      <template #icon>
        <span class="lucide-ellipsis icon" aria-hidden="true" />
      </template>
    </Button>
  </AdaptiveDropdown>
  <AdaptiveDropdown
    v-if="categoryChoice"
    v-model:open="choosing"
    :options="categorySwitches"
    :title="__('Tabs')"
  />
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed, ref } from 'vue'

import {
  useClearList,
  type ClearScope,
  type ClearTarget,
} from '@/apps/mail/composables/useClearList'
import { useTabChoiceMenu } from '@/apps/mail/composables/useInboxTabs'
import { useScreenSize } from '@/apps/mail/utils/composables'
import AdaptiveDropdown from '@/platform/feedback/AdaptiveDropdown.vue'

const {
  scope,
  target,
  inbox = false,
} = defineProps<{ scope: ClearScope; target: ClearTarget; inbox?: boolean }>()

const { menuFor } = useClearList(() => target)
const { isMobile } = useScreenSize()
const { offered, split, categoriesSwitch, categorySwitches } = useTabChoiceMenu()
const choosing = ref(false)

const categoryChoice = computed(() => inbox && isMobile.value && offered.value)

const options = computed(() => {
  if (!categoryChoice.value) return menuFor(scope)
  return [
    ...menuFor(scope),
    {
      group: '',
      options: [
        categoriesSwitch.value,
        ...(split.value
          ? [
              {
                // Named as the View menu's Tabs row on a desktop, the same choice.
                label: __('Tabs'),
                icon: 'lucide-panel-top',
                drillsIn: true,
                onClick: (): void => void (choosing.value = true),
              },
            ]
          : []),
      ],
    },
  ]
})
</script>
