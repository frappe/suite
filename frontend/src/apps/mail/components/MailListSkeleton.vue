<template>
  <!-- A list's rows before its mail arrives, in the shape its rows will take (see MailRow): one wide
       line with the reading pane off, a stacked block beside it or on a phone, and the leading column
       the list's rows have. A folder that takes a few seconds, Trash on a large account, shows a list
       on its way rather than a bare spinner, and nothing moves when the rows land. Fixed widths, so
       the rows don't shuffle on each render. Each line carries its row line's type classes, so it is
       that line's height whatever the bar inside it. -->
  <div class="animate-pulse" role="status" :aria-label="__('Loading mail')">
    <!-- The first date header, where the list's rows sit under them (see MailGroupHeader). -->
    <div v-if="dateHeaders" :class="GROUP_HEADER_BOX_CLASS" data-outline="date-header">
      <div v-if="showCheckbox" class="bg-surface-gray-3 mr-5 h-4 w-4 rounded-4" />
      <div class="bg-surface-gray-3 h-3 w-12 rounded-4" />
    </div>
    <div v-for="(row, i) in ROWS" :key="i" :class="[ROW_BOX_CLASS, { '!py-1': isFullWidth }]">
      <div
        v-if="showLeading"
        class="flex shrink-0 items-center justify-center max-sm:w-10 max-sm:justify-start"
        :class="isFullWidth ? 'h-8' : 'h-10 sm:-mt-1.5'"
      >
        <div v-if="showCheckbox" class="bg-surface-gray-3 h-4 w-4 rounded-4" />
        <div v-else class="bg-surface-gray-3 h-8 w-8 rounded-full max-sm:h-10 max-sm:w-10" />
      </div>

      <template v-if="isFullWidth">
        <div class="flex grow items-center space-x-3 truncate" :class="{ 'min-h-8': !showLeading }">
          <div class="w-48 shrink-0 text-base">
            <span :class="BAR" class="bg-surface-gray-3" :style="{ width: row.sender }" />
          </div>
          <div class="shrink-0 text-base !leading-[1.5]" :style="{ width: row.wideSubject }">
            <span :class="BAR" class="bg-surface-gray-3 w-full" />
          </div>
          <div class="min-w-0 flex-1 text-base !leading-[1.5]">
            <span :class="BAR" class="bg-surface-gray-2" :style="{ width: row.preview }" />
          </div>
        </div>
        <div class="flex shrink-0 items-center">
          <span :class="BAR" class="bg-surface-gray-3 w-10" />
        </div>
      </template>

      <div v-else class="grow space-y-1 truncate sm:space-y-0.5">
        <div class="flex items-center justify-between">
          <div class="mt-0.5 flex-1 text-[15px] sm:text-base">
            <span :class="BAR" class="bg-surface-gray-3" :style="{ width: row.sender }" />
          </div>
          <span :class="BAR" class="bg-surface-gray-3 w-10" />
        </div>
        <div class="text-sm !leading-[1.5]">
          <span :class="BAR" class="bg-surface-gray-3" :style="{ width: row.subject }" />
        </div>
        <div class="text-sm !leading-[1.5]">
          <span :class="BAR" class="bg-surface-gray-2" :style="{ width: row.preview }" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRowLayout } from '@/apps/mail/composables/useRowLayout'
import { GROUP_HEADER_BOX_CLASS, ROW_BOX_CLASS } from '@/apps/mail/constants'

// The list's own row settings, passed as the list passes them to its rows.
const {
  selectable = true,
  hideAvatar = false,
  dateHeaders = false,
} = defineProps<{
  selectable?: boolean
  hideAvatar?: boolean
  /** Whether the list's rows sit under date headers (see useListRows' headersVisible). */
  dateHeaders?: boolean
}>()

const { isFullWidth, showCheckbox, showLeading } = useRowLayout(() => ({
  selectable,
  hideAvatar,
  isSelected: false,
}))

// An inline block sits on its line's strut, so the line keeps the height its text would give it.
const BAR = 'inline-block h-3 rounded-4 align-middle'

// Sender, subject and preview widths per row. The wide line's subject is a share of the whole row.
const ROWS = [
  ['28%', '62%', '88%', '22%'],
  ['36%', '48%', '76%', '18%'],
  ['22%', '70%', '84%', '26%'],
  ['30%', '54%', '92%', '20%'],
  ['40%', '66%', '72%', '24%'],
  ['26%', '58%', '86%', '21%'],
  ['34%', '44%', '80%', '16%'],
  ['24%', '64%', '90%', '23%'],
].map(([sender, subject, preview, wideSubject]) => ({ sender, subject, preview, wideSubject }))
</script>
