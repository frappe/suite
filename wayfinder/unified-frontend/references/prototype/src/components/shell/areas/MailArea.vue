<!--
  Mail screen: thread list plus a reading pane.

  The list is the master, the pane is the detail, and the List family owns the
  link between them through `v-model:active` — so the open row keeps its
  highlight while the pointer wanders, and keyboard nav in the pane moves the
  highlight with it.
-->
<template>
  <AppSplit>
  <template #panel-header>
    <MailAccountSwitcher />
  </template>
  <template #panel>
    <MailPanel />
  </template>

  <!-- The Screener replaces the thread panes, not the whole app: it asks
       about people, so a thread list beside it would be answering the wrong
       question. The mailbox panel stays, because it is how you leave. -->
  <MailScreener v-if="isScreener" />

  <div v-else class="flex min-h-0 flex-1">
    <!-- Thread list. In the full-width layout — and on a phone, which has no
         other option — the pane is either the list or the open thread, never
         both side by side: opening a thread hides the list instead of
         squeezing in beside it. -->
    <div
      v-if="!listFull || !activeThread"
      class="flex min-h-0 flex-col border-outline-gray-1"
      :class="listFull ? 'w-full' : 'w-96 shrink-0 border-r'"
    >
      <div
        class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-outline-gray-1 pr-2"
        :class="mailDensity === 'dense' ? 'pl-[15px]' : 'pl-[23px]'"
      >
        <!-- Padded so the select-all box lands on the same x as the boxes in
             the rows below: 8px less in Dense, which drops the list's side
             padding. -->
        <div class="flex min-w-0 items-center gap-1">
          <!-- Selects everything the list is currently showing — which is the
               filtered set, not the mailbox: what you can see is what you get. -->
          <Tooltip :content="selected.size ? 'Clear selection' : 'Select all'" placement="bottom">
            <span class="flex shrink-0 items-center px-1">
              <Checkbox
                :model-value="selected.size > 0"
                :aria-label="selected.size ? 'Clear selection' : 'Select all'"
                @click.stop="toggleSelectAll"
              />
            </span>
          </Tooltip>

          <!-- One menu for which threads the list shows and in what order.
               The checkbox beside it only ever selects. -->
          <Dropdown :options="listOptions" align="start">
            <Button variant="ghost" icon="lucide-settings-2" aria-label="List settings" />
          </Dropdown>

          <!-- With rows picked out, the mailbox's name gives way to what you
               can do to them. The filter stays: it is how the selection was
               made in the first place. -->
          <template v-if="selected.size">
            <span class="mx-1 h-4 shrink-0 border-l border-outline-gray-2" aria-hidden="true" />
            <Tooltip
              v-for="action in BULK_ACTIONS"
              :key="action.label"
              :content="action.label"
              placement="bottom"
            >
              <Button
                variant="ghost"
                :icon="action.icon"
                :aria-label="action.label"
                @click="runBulk(action)"
              />
            </Tooltip>
            <span class="ml-1 shrink-0 truncate text-sm text-ink-gray-5">
              {{ selected.size }} selected
            </span>
          </template>
        </div>
        <div class="flex shrink-0 items-center">
          <Button variant="solid" icon-left="lucide-pen-line" label="Compose" />
        </div>
      </div>

      <ScrollArea class="min-h-0 flex-1">
        <!-- Dense drops the list's own side padding so a filled row runs the
             full width of the pane, the way a ruled table does. The cards in
             Compact and Cozy need that padding: it is the margin they sit in. -->
        <List
          v-model:active="activeId"
          class="pb-6"
          :class="mailDensity === 'dense' ? '' : 'px-2'"
        >
          <ListRows :items="threads" row-key="id">
            <template #default="{ item: thread }">
              <ListRow
                :value="thread.id"
                class="group"
                :class="[
                  mailDensity === 'dense'
                    ? 'mail-row-fixed relative h-12 after:pointer-events-none after:absolute after:inset-x-3 after:top-0 after:border-t after:border-outline-gray-1 after:content-[\'\']'
                    : 'mail-row-plain mb-1 rounded-4',
                  // A picked row keeps the fill the pointer would have given
                  // it, so the selection reads at a glance rather than only
                  // through a checkbox the size of a full stop.
                  //
                  // Compact and Cozy carry a 4px gap so neighbouring picks
                  // read as separate cards instead of one unbroken block.
                  // Dense does not: its rules already divide one filled row
                  // from the next, and it is meant to read as a ruled table
                  // rather than a stack of cards.
                  selected.has(thread.id) ? 'bg-surface-gray-1' : 'hover:bg-surface-gray-1',
                ]"
                @click="openThread(thread)"
              >
                <!-- Who it is from, until you reach for the row: then the same
                     square becomes the way to select it. One slot, so nothing
                     shifts as the pointer arrives. -->
                <ListCell :class="[cellAlign, pad.top]">
                  <span class="relative flex size-7 shrink-0 items-center justify-center">
                    <Avatar
                      v-if="showAvatars"
                      :size="pad.avatar"
                      :label="threadFrom(thread)"
                      :image="PEOPLE[threadFrom(thread)]"
                      class="transition-opacity"
                      :class="
                        selected.has(thread.id)
                          ? 'opacity-0'
                          : 'opacity-100 group-hover:opacity-0'
                      "
                    />
                    <!-- With avatars off there is nothing to trade places
                         with, so the box simply stays: the column is a
                         checkbox column, the way every mail client without
                         faces has always drawn it. -->
                    <span
                      class="absolute inset-0 flex items-center justify-center transition-opacity"
                      :class="
                        !showAvatars || selected.has(thread.id)
                          ? 'opacity-100'
                          : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
                      "
                    >
                      <Checkbox
                        :model-value="selected.has(thread.id)"
                        :aria-label="`Select ${threadFrom(thread)}`"
                        @click.stop="toggleSelect(thread.id)"
                      />
                    </span>
                  </span>
                </ListCell>

                <ListCell :class="cellAlign">
                  <span class="flex min-w-0 flex-col gap-0.5" :class="pad.y">
                    <!-- Dense: one line in columns, per Figma 242:28525 —
                         sender, then a 238px subject, then the message. The
                         sender column is fixed rather than sized to its text,
                         which the frame cannot show with two identical rows:
                         let it size itself and the subject starts at a
                         different x on every row, and the column stops being
                         something you can read straight down. -->
                    <span
                      v-if="mailDensity === 'dense'"
                      class="flex h-7 min-w-0 items-center gap-3"
                    >
                      <span class="flex w-40 shrink-0 items-center gap-1.5">
                        <span
                          class="truncate text-base"
                          :class="
                            thread.unread ? 'font-medium text-ink-gray-9' : 'text-ink-gray-8'
                          "
                        >
                          {{ threadFrom(thread) }}
                        </span>
                        <span
                          v-if="thread.unread"
                          class="size-1.5 shrink-0 rounded-full bg-surface-blue-7"
                          aria-hidden="true"
                        />
                        <StarMark v-if="thread.starred" class="size-3.5 shrink-0" />
                      </span>
                      <span
                        class="w-[238px] min-w-0 shrink truncate text-base"
                        :class="
                          thread.unread ? 'font-medium text-ink-gray-8' : 'text-ink-gray-7'
                        "
                      >
                        {{ thread.subject }}
                      </span>
                      <span class="min-w-0 flex-1 truncate text-base text-ink-gray-5">
                        {{ threadSnippet(thread) }}
                      </span>
                      <span
                        v-if="hasAttachment(thread)"
                        class="lucide-paperclip size-3.5 shrink-0 text-ink-gray-5"
                        aria-hidden="true"
                      />
                    </span>

                    <!-- Compact and Cozy open the same way, on the sender. -->
                    <template v-else>
                      <span class="flex min-w-0 items-center gap-1.5">
                        <span
                          class="truncate text-base"
                          :class="
                            thread.unread ? 'font-medium text-ink-gray-9' : 'text-ink-gray-8'
                          "
                        >
                          {{ threadFrom(thread) }}
                        </span>
                        <span
                          v-if="thread.unread"
                          class="size-1.5 shrink-0 rounded-full bg-surface-blue-7"
                          aria-hidden="true"
                        />
                        <StarMark v-if="thread.starred" class="size-3.5 shrink-0" />
                      </span>

                      <!-- Compact folds the snippet in behind the subject
                           instead of giving it a line of its own. -->
                      <span
                        v-if="mailDensity === 'compact'"
                        class="flex min-w-0 items-center gap-1.5"
                      >
                        <span
                          class="min-w-0 truncate text-p-sm"
                          :class="
                            thread.unread ? 'font-medium text-ink-gray-8' : 'text-ink-gray-7'
                          "
                        >
                          {{ thread.subject }}
                          <span class="font-normal text-ink-gray-5">
                            — {{ threadSnippet(thread) }}
                          </span>
                        </span>
                        <span
                          v-if="hasAttachment(thread)"
                          class="lucide-paperclip size-3.5 shrink-0 text-ink-gray-5"
                          aria-hidden="true"
                        />
                      </span>

                      <template v-else>
                        <span
                          class="truncate text-p-sm"
                          :class="
                            thread.unread ? 'font-medium text-ink-gray-8' : 'text-ink-gray-7'
                          "
                        >
                          {{ thread.subject }}
                        </span>
                        <span class="flex min-w-0 items-center gap-1.5">
                          <span class="min-w-0 truncate text-p-sm text-ink-gray-5">
                            {{ threadSnippet(thread) }}
                          </span>
                          <span
                            v-if="hasAttachment(thread)"
                            class="lucide-paperclip size-3.5 shrink-0 text-ink-gray-5"
                            aria-hidden="true"
                          />
                        </span>
                      </template>
                    </template>
                  </span>
                </ListCell>

                <!-- The timestamp hands its place to the row's actions while
                     the pointer is on the row. They share one fixed-width
                     column so neither one reflows the content beside it. -->
                <ListCell :class="[cellAlign, pad.top]">
                  <span class="relative flex h-7 w-[4.5rem] items-center justify-end">
                    <span
                      class="text-ink-gray-5 transition-opacity group-hover:opacity-0"
                      :class="mailDensity === 'dense' ? 'text-sm' : 'text-xs'"
                    >
                      {{ formatTime(lastMessage(thread).time) }}
                    </span>
                    <!-- Wider than its column on purpose: it floats left over
                         the snippet rather than reserving room no row uses
                         until the pointer is on it. -->
                    <span
                      class="pointer-events-none absolute right-0 flex items-center gap-0.5 rounded-4 bg-surface-base px-0.5 shadow-sm opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
                    >
                      <Tooltip :content="thread.starred ? 'Unstar' : 'Star'" placement="top">
                        <Button
                          variant="ghost"
                          size="sm"
                          :aria-label="thread.starred ? 'Unstar' : 'Star'"
                          @click.stop="thread.starred = !thread.starred"
                        >
                          <StarMark v-if="thread.starred" class="size-4" />
                          <span v-else class="lucide-star size-4" aria-hidden="true" />
                        </Button>
                      </Tooltip>
                      <Tooltip
                        v-for="action in ROW_ACTIONS"
                        :key="action.label"
                        :content="action.label"
                        placement="top"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          :icon="action.icon"
                          :aria-label="action.label"
                          @click.stop
                        />
                      </Tooltip>
                    </span>
                  </span>
                </ListCell>
              </ListRow>
            </template>
          </ListRows>
        </List>

        <div
          v-if="!threads.length"
          class="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center"
        >
          <span class="lucide-inbox size-7 text-ink-gray-4" aria-hidden="true" />
          <span class="text-base text-ink-gray-6">
            {{ mailSearch || filter !== 'all' ? 'No threads match this view' : 'Nothing here' }}
          </span>
        </div>
      </ScrollArea>
    </div>

    <!-- Reading pane -->
    <MailThreadView
      v-if="activeThread"
      :key="activeThread.id"
      :thread="activeThread"
      :has-prev="activeIndex > 0"
      :has-next="activeIndex < threads.length - 1"
      @close="activeId = undefined"
      @prev="step(-1)"
      @next="step(1)"
      @toggle-read="activeThread.unread = !activeThread.unread"
    />
    <!-- With one pane, and nothing open, the list already fills it: this
         placeholder belongs to the split layout's second pane, not underneath
         a full-width list. -->
    <div
      v-else-if="!listFull"
      class="flex min-w-0 flex-1 flex-col items-center justify-center gap-2"
    >
      <span class="lucide-mail size-8 text-ink-gray-4" aria-hidden="true" />
      <span class="text-base text-ink-gray-5">Select a thread to read it</span>
    </div>
  </div>
  </AppSplit>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Avatar, Button, Checkbox, Dropdown, ScrollArea, Tooltip } from 'frappe-ui'
import { List, ListCell, ListRow, ListRows } from 'frappe-ui/list'

import AppSplit from '../parts/AppSplit.vue'
import MailAccountSwitcher from '../parts/MailAccountSwitcher.vue'
import MailPanel from '../parts/panels/MailPanel.vue'
import MailScreener from '../parts/MailScreener.vue'
import StarMark from '../parts/StarMark.vue'
import { formatTime } from '../mailTime'
import MailThreadView from '../parts/MailThreadView.vue'
import {
  MAIL_PLACES,
  lastMessage,
  threadFrom,
  threadSnippet,
  threadsIn,
  type MailThread,
} from '../mailFixtures'
import { PEOPLE } from '../fixtures'
import { isMobile } from '../useIsMobile'
import {
  DENSITY_PAD,
  mailDensity,
  mailLayout,
  mailSettingsOpen,
  showAvatars,
} from '../useMailAppearance'
import { useRouter } from 'vue-router'

import { screenNewSenders } from '../mailSettings'
import { mailSearch } from '../useMailSearch'
import { useShellNav } from '../useShellNav'

const { sub, areaTo } = useShellNav()
const router = useRouter()

const isScreener = computed(() => screenNewSenders.value && sub.value === 'screener')

// Turning screening off while standing in the Screener takes away the place
// you are standing in. The inbox is where those senders' mail now lands, so
// that is where you go — replaced rather than pushed, so Back does not return
// to a screen that no longer exists. Immediate, so a stale /mail/screener URL
// resolves the same way on load.
watch(
  [screenNewSenders, sub],
  ([screening, current]) => {
    if (!screening && current === 'screener') router.replace(areaTo('mail', 'inbox'))
  },
  { immediate: true },
)

// Full-width list and a phone want the same thing: one pane at a time, with an
// open thread replacing the list rather than squeezing in beside it. Which is
// also what makes Dense worth having — a single-line row needs the window's
// width before the snippet has anywhere to go.
const listFull = computed(() => isMobile.value || mailLayout.value === 'full')

const mailbox = computed(() => MAIL_PLACES.find((m) => m.id === (sub.value || 'inbox')))
const mailboxLabel = computed(() => mailbox.value?.label ?? 'Inbox')

const sort = ref<'newest' | 'oldest'>('newest')

/** The list's own filter, in the header beside the select-all box. */
const MAIL_FILTERS = [
  { value: 'all', label: 'All', icon: 'lucide-inbox' },
  { value: 'unread', label: 'Unread', icon: 'lucide-mail' },
  { value: 'starred', label: 'Starred', icon: 'lucide-star' },
  { value: 'attachments', label: 'Has attachments', icon: 'lucide-paperclip' },
] as const

type MailFilter = (typeof MAIL_FILTERS)[number]['value']

const filter = ref<MailFilter>('all')

const filterOptions = computed(() =>
  MAIL_FILTERS.map((option) => ({
    label: option.label,
    icon: option.icon,
    selected: option.value === filter.value,
    onClick: () => (filter.value = option.value),
  })),
)

const threads = computed(() => {
  const query = mailSearch.value.trim().toLowerCase()
  let rows = threadsIn(mailbox.value?.id ?? 'inbox')
  if (filter.value === 'unread') rows = rows.filter((thread) => thread.unread)
  else if (filter.value === 'starred') rows = rows.filter((thread) => thread.starred)
  else if (filter.value === 'attachments') rows = rows.filter(hasAttachment)
  if (query) {
    rows = rows.filter((thread) =>
      [thread.subject, threadFrom(thread), threadSnippet(thread)]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }
  return sort.value === 'oldest' ? [...rows].reverse() : rows
})

const unreadCount = computed(() => threads.value.filter((thread) => thread.unread).length)

const pad = computed(() => DENSITY_PAD[mailDensity.value])

// Dense is one line in a fixed 48px box, so its cells centre in that box.
// Compact and Cozy grow with their contents, where there is no spare height to
// centre against: their cells hang from the top and the padding does the rest.
const cellAlign = computed(() => (mailDensity.value === 'dense' ? 'self-center' : 'self-start'))

/** Shown on hover, in the timestamp's place. Star is separate: it has state. */
const ROW_ACTIONS = [
  { label: 'Archive', icon: 'lucide-archive' },
  { label: 'Snooze', icon: 'lucide-clock' },
  { label: 'Delete', icon: 'lucide-trash-2' },
]

// Rows the checkbox has picked out. Replaced rather than mutated, so the set
// itself is what changes and the rows re-render.
const selected = ref<Set<string>>(new Set())

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

// One box for both directions: anything selected, and it clears; nothing
// selected, and it takes the whole visible list. It reads as checked whenever
// the selection is not empty — a half-selected list says how many it holds in
// words beside it, which is plainer than a third checkbox state.
function toggleSelectAll() {
  selected.value = selected.value.size
    ? new Set()
    : new Set(threads.value.map((thread) => thread.id))
}

/**
 * What the header offers to do with the selection.
 *
 * Only `apply` acts: marking as unread is the one of the four whose result is
 * visible in a prototype with no server behind it. Archive, spam and trash
 * file a thread somewhere this fixture set has no room for, so they clear the
 * selection and stop there rather than making threads vanish with nothing to
 * undo them — the same bargain every other action in this shell makes.
 */
const BULK_ACTIONS: { label: string; icon: string; apply?: (thread: MailThread) => void }[] = [
  { label: 'Mark as unread', icon: 'lucide-mail', apply: (thread) => (thread.unread = true) },
  { label: 'Archive', icon: 'lucide-archive' },
  { label: 'Report spam', icon: 'lucide-shield-alert' },
  { label: 'Move to trash', icon: 'lucide-trash-2' },
]

function runBulk(action: (typeof BULK_ACTIONS)[number]) {
  if (action.apply) {
    threads.value.filter((thread) => selected.value.has(thread.id)).forEach(action.apply)
  }
  selected.value = new Set()
}

const activeId = ref<string>()
const activeIndex = computed(() => threads.value.findIndex((t) => t.id === activeId.value))
const activeThread = computed(() => threads.value[activeIndex.value] ?? null)

// Switching mailbox or filtering the list can drop the open thread, so the pane
// closes rather than showing a row the list no longer has.
watch(threads, (rows) => {
  if (activeId.value && !rows.some((thread) => thread.id === activeId.value)) {
    activeId.value = undefined
  }
  // Same for the selection: a header that counts rows the list is no longer
  // showing would act on threads the person cannot see.
  if (selected.value.size) {
    const visible = new Set(rows.map((thread) => thread.id))
    const next = new Set([...selected.value].filter((id) => visible.has(id)))
    if (next.size !== selected.value.size) selected.value = next
  }
})

function openThread(thread: MailThread) {
  thread.unread = false
}

/** Newer / older in the pane header walks the list the user is looking at. */
function step(delta: number) {
  const next = threads.value[activeIndex.value + delta]
  if (!next) return
  next.unread = false
  activeId.value = next.id
}

function hasAttachment(thread: MailThread) {
  return thread.messages.some((message) => message.attachments?.length)
}

const listOptions = computed(() => [
  { group: 'Filter', options: filterOptions.value },
  {
    group: 'Sort',
    options: [
      {
        label: 'Newest first',
        selected: sort.value === 'newest',
        onClick: () => (sort.value = 'newest'),
      },
      {
        label: 'Oldest first',
        selected: sort.value === 'oldest',
        onClick: () => (sort.value = 'oldest'),
      },
    ],
  },
])
</script>

<style scoped>
/*
  Dense's height goes on the row, but the flex line that actually holds the
  cells is a wrapper ListRow renders inside it. Left alone that wrapper sizes
  to its content, so `self-center` on a cell would centre it against the text
  rather than against the 48px box — the row would be the right height with
  its contents sitting at the top. Stretching the wrapper to fill is what puts
  the two back in the same coordinate space. Compact and Cozy have no fixed
  height to fill, so they do not take this class.
*/
.mail-row-fixed > :deep(div) {
  height: 100%;
}

/*
  ListRow draws Dense's rule on an element of its own that begins after the
  first cell — so the line started level with the sender rather than with the
  avatar, while its right end reached the timestamp. Gmail rules its rows that
  way because the leading column is a checkbox gutter; here the leading column
  is the avatar, which is part of the row and wants the line under it.

  So that one is switched off and the row draws its own, as an ::after inset
  by the row's 12px padding: it starts at the avatar's left edge and ends
  where the time does, which is what makes it read as one rule across the row
  rather than a line that begins somewhere in the middle.
*/
.mail-row-fixed :deep(.border-t) {
  border-top-width: 0 !important;
}

/*
  The List family rules off every row, and it draws that rule with `divide-y`
  — a border on the *top* of every row after the first, not the bottom. Dense
  wants the rules; Compact and Cozy are meant to read as free-standing cards
  with nothing between them, and there is no prop for it.

  Both edges are zeroed, and !important is the honest tool here: this is one
  utility class overriding another at equal specificity, where otherwise the
  winner is whichever stylesheet the runtime happens to inject last.
*/
.mail-row-plain {
  border-top-width: 0 !important;
  border-bottom-width: 0 !important;
}

/*
  The rule itself is not on the row but on a wrapper ListRow renders inside
  it, which is why it survived being zeroed on the row and why it started at
  the avatar rather than at the row's edge. `:deep` is what reaches it: that
  div belongs to ListRow's template, not this one, so it carries no scope id.
  Held to direct children, so the checkbox's own 1px border is left alone.
*/
.mail-row-plain > :deep(div) {
  border-top-width: 0 !important;
  border-bottom-width: 0 !important;
}
</style>
