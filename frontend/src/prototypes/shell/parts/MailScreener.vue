<!--
  PROTOTYPE — remove. The Screener: one decision per first-time sender.

  It is deliberately not a list with a reading pane. The question here is
  "should this person reach me at all", so the screen shows whole people —
  name, address, why they are writing, how much is already waiting — and gives
  each one exactly two answers. Deciding is the only interaction.
-->
<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-outline-gray-1 pl-5 pr-2"
    >
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="truncate text-base font-medium text-ink-gray-9">Screener</span>
        <span v-if="visible.length" class="shrink-0 text-sm text-ink-gray-5">
          {{ visible.length }}
          {{ showBlocked ? 'screened out' : visible.length === 1 ? 'person waiting' : 'people waiting' }}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-0.5">
        <Button
          :variant="showBlocked ? 'subtle' : 'ghost'"
          label="Screened out"
          @click="showBlocked = !showBlocked"
        />
        <Dropdown :options="screenerOptions" align="end">
          <Button variant="ghost" icon="lucide-ellipsis" aria-label="Screener settings" />
        </Dropdown>
      </div>
    </div>

    <ScrollArea class="min-h-0 flex-1" viewport-class="px-6 py-6">
      <div class="mx-auto flex max-w-2xl flex-col gap-4">
        <p v-if="!showBlocked && waiting.length" class="text-p-sm text-ink-gray-6">
          You decide once per person. Yes puts everything they send in your Inbox. No means you
          never see them again, and they are never told.
        </p>

        <!-- The queue. Cards leave on decision, so the pile visibly shrinks. -->
        <TransitionGroup
          tag="div"
          class="flex flex-col gap-3"
          enter-active-class="transition duration-150 ease-out"
          enter-from-class="opacity-0"
          leave-active-class="absolute w-full transition duration-150 ease-out"
          leave-to-class="opacity-0 -translate-x-2"
          move-class="transition-transform duration-200 ease-out"
        >
          <article
            v-for="sender in visible"
            :key="sender.id"
            class="rounded-5 border border-outline-gray-2 px-4 py-4"
          >
            <header class="flex items-start gap-3">
              <Avatar size="2xl" :image="sender.avatar" :label="sender.name" />
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate text-lg font-medium text-ink-gray-9">
                  {{ sender.name }}
                </span>
                <span class="truncate text-p-sm text-ink-gray-6">{{ sender.email }}</span>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span class="text-xs text-ink-gray-5">{{ sender.time }}</span>
                <Badge
                  :label="`${sender.waiting} waiting`"
                  theme="gray"
                  variant="subtle"
                  size="sm"
                />
              </div>
            </header>

            <!-- What they wrote sits inside the card, indented under the
                 person, because it is evidence for the decision rather than
                 mail you are reading. -->
            <div class="mt-3 border-l-2 border-outline-gray-2 pl-3">
              <p class="text-p-base font-medium text-ink-gray-8">{{ sender.subject }}</p>
              <p class="mt-0.5 line-clamp-2 text-p-sm text-ink-gray-6">{{ sender.snippet }}</p>
            </div>

            <div class="mt-3 flex items-center gap-1.5">
              <span class="lucide-info size-3.5 shrink-0 text-ink-gray-5" aria-hidden="true" />
              <span class="truncate text-xs text-ink-gray-5">{{ sender.context }}</span>
            </div>

            <div class="mt-4 flex items-center gap-2">
              <template v-if="showBlocked">
                <Button
                  variant="subtle"
                  label="Let them in after all"
                  icon-left="lucide-check"
                  @click="decide(sender, 'in')"
                />
              </template>
              <!-- The two answers carry equal weight. Neither is destructive
                   and neither is the recommended one: saying no is a routine
                   answer, not a warning, so no solid and no red. -->
              <template v-else>
                <Button
                  variant="subtle"
                  label="Yes, let them in"
                  icon-left="lucide-check"
                  @click="decide(sender, 'in')"
                />
                <Button
                  variant="subtle"
                  label="No, never"
                  icon-left="lucide-x"
                  @click="decide(sender, 'out')"
                />
                <Button variant="ghost" label="Read first" icon-left="lucide-mail-open" />
              </template>
            </div>
          </article>
        </TransitionGroup>

        <!-- Empty states differ: a cleared queue is an achievement, an empty
             blocked list is just a fact. -->
        <div
          v-if="!visible.length"
          class="flex flex-col items-center justify-center gap-1.5 py-20 text-center"
        >
          <span
            :class="[showBlocked ? 'lucide-user-round-x' : 'lucide-check', 'size-7 text-ink-gray-4']"
            aria-hidden="true"
          />
          <span class="text-base text-ink-gray-7">
            {{ showBlocked ? 'Nobody screened out' : 'Screener is clear' }}
          </span>
          <span class="max-w-sm text-p-sm text-ink-gray-5">
            {{
              showBlocked
                ? 'People you turn away show up here, so a decision is never final.'
                : 'The next person who writes to you for the first time will wait here.'
            }}
          </span>
        </div>
      </div>
    </ScrollArea>

    <!-- One undo, pinned where the decision was made, so the last answer is
         always reversible without a toast to chase. -->
    <div
      v-if="lastDecision"
      class="flex h-11 shrink-0 items-center justify-between gap-2 border-t border-outline-gray-1 px-5"
    >
      <span class="truncate text-p-sm text-ink-gray-7">
        <span class="font-medium text-ink-gray-8">{{ lastDecision.sender.name }}</span>
        {{ lastDecision.verdict === 'in' ? 'goes to your Inbox.' : 'will never reach you.' }}
      </span>
      <Button variant="ghost" label="Undo" icon-left="lucide-undo-2" @click="screenerUndo()" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Avatar, Badge, Button, Dropdown, ScrollArea } from 'frappe-ui'

import {
  SCREENER_SENDERS,
  screenerDecide,
  screenerDecisions,
  screenerScreenedOut,
  screenerUndo,
  screenerWaiting,
  type ScreenerSender,
  type ScreenerVerdict,
} from '../mailFixtures'

const showBlocked = ref(false)

const waiting = computed(() => screenerWaiting())
const visible = computed(() => (showBlocked.value ? screenerScreenedOut() : waiting.value))

const lastDecision = computed(() => {
  const decision = screenerDecisions.value[screenerDecisions.value.length - 1]
  if (!decision) return null
  const sender = SCREENER_SENDERS.find((s) => s.id === decision.senderId)
  return sender ? { sender, verdict: decision.verdict } : null
})

function decide(sender: ScreenerSender, verdict: ScreenerVerdict) {
  screenerDecide(sender.id, verdict)
}

const screenerOptions = [
  {
    label: 'Screen every new sender',
    icon: 'lucide-user-round-check',
    selected: true,
    onClick: () => {},
  },
  { label: 'Auto-approve my contacts', icon: 'lucide-users', selected: true, onClick: () => {} },
  { label: 'Screening rules', icon: 'lucide-list-filter', onClick: () => {} },
]
</script>
