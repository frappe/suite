<!--
  The account an area's sidebar is showing, at the top of its body, and the menu that switches it.

  The button shows what the picked row shows: the account's mark and its name. With nothing to
  pick (one account, or `fixed`) the account is only named.

  Mail, Calendar and People each built this row themselves, and the three drifted. An app passes
  only what differs: its accounts, what the button says, and where a pick takes the reader.
-->
<template>
  <!-- touch-target-row grows the row's hit area on a touch screen only where no other row is, and
       needs its section isolated. -->
  <SidebarSection class="isolate !mt-0">
    <Dropdown v-if="options.length" :options="options" :match-trigger-width="true">
      <SidebarItem :label="label" class="touch-target-row">
        <template #prefix>
          <AccountMark :name="mark" :class="MARK_IN_ICON_COLUMN" />
        </template>
        <template #suffix>
          <span class="lucide-chevrons-up-down mr-2 size-3.5 text-ink-gray-5" aria-hidden="true" />
        </template>
      </SidebarItem>
    </Dropdown>
    <SidebarItem v-else :label="label" class="touch-target-row">
      <template #prefix>
        <AccountMark :name="mark" :class="MARK_IN_ICON_COLUMN" />
      </template>
    </SidebarItem>
  </SidebarSection>
</template>

<script setup lang="ts">
import { Dropdown, SidebarItem, SidebarSection } from 'frappe-ui'
import { computed } from 'vue'

import AccountMark from './AccountMark.vue'
import {
  accountSubmenu,
  type Account,
  type AccountUnread,
  type AllAccountsOption,
} from './accountSubmenu'

const props = withDefaults(
  defineProps<{
    accounts: Account[] | undefined
    /** The account in use. */
    activeId: string | undefined
    /** What the button says: the account in use, as the app names it. */
    label: string
    /** Offers every account at once, for an app that can merge them. */
    all?: AllAccountsOption
    /** What is unread in each account, by account id, shown on the rows not in use. */
    unread?: AccountUnread
    /** Names the account without offering the others. */
    fixed?: boolean
  }>(),
  { all: undefined, unread: undefined, fixed: false },
)

const emit = defineEmits<{ select: [accountId: string] }>()

// The mark is 20px in a column of 16px icons. It takes an icon's width, so its center is the
// icons' and the name beside it starts where the folders' names do.
const MARK_IN_ICON_COLUMN = '-mx-0.5'

const mark = computed(() => {
  if (props.all?.active && !props.fixed) return null
  return props.accounts?.find((account) => account.id === props.activeId)?._name ?? props.label
})

// Empty when there is nothing to pick.
const options = computed(() =>
  !props.fixed && (props.accounts?.length ?? 0) > 1
    ? accountSubmenu(
        props.accounts,
        props.activeId,
        (id) => emit('select', id),
        props.all,
        props.unread,
      )
    : [],
)
</script>
