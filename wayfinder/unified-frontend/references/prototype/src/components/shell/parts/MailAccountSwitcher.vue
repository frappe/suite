<!--
  Which mailbox you are reading, at the top of Mail's own panel.

  Same mechanic as the workspace switcher, deliberately: one card, always
  mounted, growing from the row's own height with its background and shadow
  fading up under it. The account's name and address never move between shut
  and open, so the menu reads as the row unfolding. Two switchers in one shell
  that behaved differently would be two things to learn.

  It sits outside the panel's ScrollArea (see AppSplit's panel-header slot):
  the card overlays the list below it, and a scroll container would clip it.
-->
<template>
  <div ref="root" class="relative h-12 w-full">
    <div
      ref="card"
      @scroll="resetScroll"
      class="account-card absolute -left-1 -right-1 -top-1 z-30 overflow-hidden rounded-[12px] p-1"
      :class="
        open
          ? 'is-open bg-surface-base duration-200 ease-out'
          : 'bg-transparent duration-[70ms] ease-in'
      "
      :style="{ height: `${open ? openHeight : CLOSED_HEIGHT}px` }"
    >
      <button
        type="button"
        class="flex h-12 w-full items-center gap-2 rounded-[10px] px-1.5 transition-colors hover:bg-surface-gray-2"
        :title="current.email"
        @click="open = !open"
      >
        <Avatar size="lg" :image="USER.avatar" :label="current.name" class="shrink-0" />
        <span class="flex min-w-0 flex-1 flex-col text-left">
          <span class="truncate text-base font-medium leading-tight text-ink-gray-8">
            {{ current.name }}
          </span>
          <span class="truncate text-xs leading-tight text-ink-gray-5">{{ current.email }}</span>
        </span>
        <span
          class="lucide-chevrons-up-down size-4 shrink-0 text-ink-gray-5"
          aria-hidden="true"
        />
      </button>

      <!-- Everything below the first row is what the card grows to reveal.
           Shut, it is `inert`: it is still in the card, merely clipped, and a
           clipped button is still a focusable one. Anything that hands focus
           back to a row down here — closing Mail settings restores focus to
           the row that opened it — makes the browser scroll this card to
           reveal it, and the trigger above gets pushed out of the clip. -->
      <div
        class="transition-opacity"
        :inert="!open"
        :class="open ? 'opacity-100 duration-200 ease-out' : 'opacity-0 duration-[70ms] ease-in'"
      >
        <div class="my-1 h-px bg-outline-gray-2" />

        <div class="account-label flex h-7 items-center px-1.5">
          <SidebarLabel>Accounts</SidebarLabel>
        </div>

        <button
          v-for="account in MAIL_ACCOUNTS"
          :key="account.id"
          type="button"
          class="flex h-9 w-full items-center gap-2 rounded-[10px] px-1.5 transition-colors hover:bg-surface-gray-2"
          @click="pick(account.id)"
        >
          <Avatar size="sm" :image="USER.avatar" :label="account.name" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate text-left text-base text-ink-gray-7">
            {{ account.email }}
          </span>
          <span
            v-if="unread"
            class="shrink-0 rounded-full bg-surface-gray-3 px-1.5 text-xs text-ink-gray-7"
          >
            {{ unread }}
          </span>
          <span
            v-if="account.id === currentId"
            class="lucide-check size-4 shrink-0 text-ink-gray-6"
            aria-hidden="true"
          />
        </button>

        <div class="my-1 h-px bg-outline-gray-2" />

        <button
          type="button"
          class="flex h-9 w-full items-center gap-2 rounded-[10px] px-1.5 transition-colors hover:bg-surface-gray-2"
          @click="close"
        >
          <span class="lucide-user-plus size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-left text-base text-ink-gray-7">
            Add account
          </span>
        </button>

        <button
          type="button"
          class="flex h-9 w-full items-center gap-2 rounded-[10px] px-1.5 transition-colors hover:bg-surface-gray-2"
          @click="openSettings"
        >
          <span class="lucide-settings size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-left text-base text-ink-gray-7">
            Mail settings
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { Avatar, SidebarLabel } from 'frappe-ui'
import { useEventListener } from '@vueuse/core'

import { USER } from '../fixtures'
import { MAIL_ACCOUNTS, unreadIn } from '../mailFixtures'
import { mailSettingsOpen } from '../useMailAppearance'

// Every row height is fixed, so the open height is arithmetic rather than
// measured — which is what lets height be a plain CSS transition.
const PAD = 8 // the card's p-1, top and bottom
const HEAD = 48 // the account row, repeated from the trigger
const RULE = 9 // a divider plus its my-1
const LABEL = 28 // the section label, h-7
const ROW = 36 // an account or action row, h-9
const ACTIONS = 2 // Add account, Mail settings

const CLOSED_HEIGHT = PAD + HEAD

const open = ref(false)
const root = useTemplateRef<HTMLElement>('root')
const card = useTemplateRef<HTMLElement>('card')

// The card's height is its whole mechanic, so it must never hold a scroll
// offset. `overflow-hidden` stops a person scrolling it but not the browser,
// which scrolls any container to bring a focused descendant into view.
function resetScroll() {
  if (card.value) card.value.scrollTop = 0
}
const currentId = ref(MAIL_ACCOUNTS[0].id)

const current = computed(
  () => MAIL_ACCOUNTS.find((a) => a.id === currentId.value) ?? MAIL_ACCOUNTS[0],
)

const openHeight = computed(
  () => PAD + HEAD + RULE + LABEL + ROW * MAIL_ACCOUNTS.length + RULE + ROW * ACTIONS,
)

// The same count the Inbox row shows, so the badge and the list agree.
const unread = computed(() => unreadIn('inbox'))

function close() {
  open.value = false
}

function openSettings() {
  close()
  mailSettingsOpen.value = true
}

function pick(id: string) {
  currentId.value = id
  close()
}

// Dismissal is owned here rather than handed to a directive, so the ordering
// is knowable: `mousedown` lands before the trigger's own click has changed
// any state, and the test is against the wrapper, which never unmounts.
useEventListener(window, 'mousedown', (event: MouseEvent) => {
  if (!open.value) return
  if (!root.value?.contains(event.target as Node)) close()
})

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (open.value && event.key === 'Escape') close()
})
</script>

<style scoped>
/*
  The card carries no surface until it opens, so shut it is the bare row.
  elevation/light/base, copied from the Figma effect style rather than
  approximated — the same one the workspace switcher uses.
*/
.account-card {
  box-shadow: none;
  transition-property: height, background-color, box-shadow;
}

/*
  SidebarLabel carries its own pl-2, which is what lines it up with a
  SidebarItem in the app panel — both are padded by 8. The rows in this card
  are px-1.5, so the label inherited a 2px indent nothing else in the card
  shares, and "Accounts" sat 8px right of the avatars beneath it. Zeroing the
  label's own padding hands the alignment back to the card's own 6px, so the
  section label starts exactly where the avatar circles do.
*/
.account-label > :deep(div) {
  padding-left: 0;
}

.account-card.is-open {
  box-shadow:
    0 2px 5px rgba(0, 0, 0, 0.14),
    0 0 1.5px rgba(0, 0, 0, 0.16),
    inset 0 0.25px 1.5px rgba(255, 255, 255, 0.08);
}
</style>
