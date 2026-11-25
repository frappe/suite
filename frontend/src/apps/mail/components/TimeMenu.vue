<template>
  <!-- Desktop with nothing to hang a menu off (a selection bar's click): a small
       dialog, the same choices as rows, as a phone's sheet lists them; a time of the reader's own
       takes their place in it. -->
  <Dialog v-if="!isMobile && !$slots.default" v-model:open="dialogOpen" :title size="xs">
    <CustomTimeForm
      v-if="formShown"
      :action
      :past-message
      :initial-value
      @pick="pick"
      @cancel="dialogOpen = false"
    />
    <div v-else class="-mx-3">
      <button
        v-for="choice in listed"
        :key="choice.value"
        class="hover:bg-surface-gray-2 text-ink-gray-8 flex w-full items-center gap-3 rounded-6 px-3 py-2 text-base"
        @click="pick(choice.value)"
      >
        <span class="flex-1 truncate text-left">{{ choice.label }}</span>
        <span class="text-ink-gray-5 shrink-0 text-sm">{{ choice.display }}</span>
      </button>
      <button
        class="hover:bg-surface-gray-2 text-ink-gray-8 flex w-full items-center rounded-6 px-3 py-2 text-base"
        @click="picking = true"
      >
        {{ __('Pick a date and time…') }}
      </button>
    </div>
  </Dialog>
  <!-- A menu off its own button (a sheet on a phone, opened by a trigger or from another sheet by
       v-model:open), each choice one click, its exact time beside it. -->
  <template v-else>
    <AdaptiveDropdown v-if="menu" v-model:open="open" :options :title align="end">
      <slot />
    </AdaptiveDropdown>
    <!-- The menu is another's (the composer's Send menu asks it as a submenu): only the reader's own
         time opens from here. -->
    <slot v-else />
    <!-- A time of the reader's own: a dialog on desktop, a sheet on a phone. Each mounts the form
         as it opens and drops it once it has closed, so the form starts afresh every time and the
         dialog or sheet leaves whole. -->
    <Dialog v-if="!isMobile" v-model:open="picking" :title size="xs">
      <CustomTimeForm :action :past-message :initial-value @pick="pick" @cancel="picking = false" />
    </Dialog>
    <BottomSheet v-else v-model:open="picking" :title>
      <div class="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <CustomTimeForm
          :action
          :past-message
          :initial-value
          @pick="pick"
          @cancel="picking = false"
        />
      </div>
    </BottomSheet>
  </template>
</template>

<script setup lang="ts">
import { BottomSheet, Dialog } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import CustomTimeForm from '@/apps/mail/components/CustomTimeForm.vue'
import { useScreenSize } from '@/apps/mail/utils/composables'
import type { TimeChoice } from '@/apps/mail/utils/snoozeTimes'
import { timeMenuOptions, type TimeMenuFooter } from '@/apps/mail/utils/timeMenuOptions'
import AdaptiveDropdown from '@/platform/feedback/AdaptiveDropdown.vue'

// A time to do something at (snooze until, remind on): a few choices, or one of the reader's own.
// Shared so every place a time is asked for asks the same way, and settles on the first click.
const {
  choices,
  title,
  action,
  pastMessage,
  initialValue,
  menu = true,
  footer,
  choicesHeading,
} = defineProps<{
  // Read as the menu opens, so "Later today" counts from then.
  choices: () => TimeChoice[]
  // The menu, the dialogs and the phone's sheets are headed with it.
  title: string
  // What the reader's own time is settled with.
  action: string
  pastMessage: string
  initialValue?: string
  menu?: boolean
  // Under the times, in the menu or sheet that has a trigger or v-model:open to hang off.
  footer?: TimeMenuFooter
  // Over the choices on a phone's sheet, under its title: where the title says what is set, this
  // says the choices change it. A desktop menu heads the choices with the title itself.
  choicesHeading?: string
}>()

const emit = defineEmits<{
  pick: [value: string]
}>()

const open = defineModel<boolean>('open', { default: false })
// The reader's own time is being picked: v-model:picking, for a menu elsewhere that offers it.
const picking = defineModel<boolean>('picking', { default: false })
const { isMobile } = useScreenSize()

// Read as the menu opens, so "Later today" counts from then. Kept while it closes, so a phone's
// sheet slides away with its rows rather than emptying first.
const listed = ref<TimeChoice[]>([])
watch(
  open,
  (shown) => {
    if (shown) listed.value = choices()
  },
  { immediate: true },
)
const options = computed(() =>
  timeMenuOptions(
    listed.value,
    (value) => emit('pick', value),
    () => (picking.value = true),
    // A desktop menu says what the time is for; a phone's sheet already has it as its title.
    isMobile.value ? choicesHeading : title,
    footer,
  ),
)

const pick = (value: string) => {
  picking.value = false
  open.value = false
  emit('pick', value)
}

// The dialog stays up from the choices to a time of the reader's own, and closing it ends both.
// What it shows, the choices or the form, holds while it fades out, so it leaves as it was.
const formShown = ref(false)
watch([open, picking], ([shown, ownTime]) => {
  if (shown || ownTime) formShown.value = ownTime
})
const dialogOpen = computed({
  get: () => open.value || picking.value,
  set: (shown) => {
    if (shown) return
    open.value = false
    picking.value = false
  },
})
</script>
