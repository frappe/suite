import { computed, inject } from 'vue'

import type { UserResource } from '@/apps/mail/types'
import { useScreenSize } from '@/apps/mail/utils/composables'

/**
 * How a list row is laid out: one wide line or a stacked block, and what its leading column holds.
 * A mail row (MailRow) and a loading list's outline rows (MailListSkeleton) both read it, so the
 * outline takes the shape the rows will have and nothing moves when they arrive.
 */
export const useRowLayout = (
  row: () => { selectable: boolean; hideAvatar: boolean; isSelected: boolean },
) => {
  const user = inject<UserResource>('$user')
  if (!user) throw new Error('Missing required user provider')
  const { isMobile } = useScreenSize()

  // With the reading pane hidden the list has the window to itself, so a row lays out as one wide
  // line instead of a stacked block.
  const isFullWidth = computed(() => !(user.data.show_reading_pane || isMobile.value))
  const showCheckbox = computed(() => !isMobile.value && row().selectable)
  const showAvatar = computed(
    () => !row().isSelected && (isMobile.value || !row().selectable) && !row().hideAvatar,
  )
  // With no checkbox, no check circle and no avatar there is nothing left to reserve space for.
  const showLeading = computed(() => showCheckbox.value || row().isSelected || showAvatar.value)

  return { isMobile, isFullWidth, showCheckbox, showAvatar, showLeading }
}
