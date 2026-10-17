<template>
  <!-- The decision a screened thread is waiting on, in the thread itself: the rest of the thread view
	     works as usual, and acting on the thread decides it too. Every sender it waits on is asked
	     about at once, and Yes / No answer for all of them; the arrow beside Yes can single one out,
	     or trust a domain they share. Yes lets their images in for good; until then each message offers
	     its own (see HiddenImagesBanner). A banner on desktop; on a phone, a full-bleed row. -->
  <div class="sm:space-y-2" role="region" :aria-label="__('Unknown sender')">
    <div class="bg-surface-gray-1 flex items-center gap-3 px-3 py-2 max-sm:border-b sm:rounded-6">
      <UserRoundSearch class="text-ink-gray-5 size-4 shrink-0" />
      <div class="text-p-sm text-ink-gray-8 min-w-0 flex-1 truncate" :title="emails">
        {{ __('Do you want mail from') }}
        <template v-if="senders.length === 1">
          <span class="!font-medium">{{ senders[0].email }}</span
          >?
        </template>
        <template v-else-if="senders.length === 2">
          <span class="!font-medium">{{ nameOf(senders[0]) }}</span>
          {{ __('and') }}
          <span class="!font-medium">{{ nameOf(senders[1]) }}</span
          >?
        </template>
        <template v-else>
          <span class="!font-medium">{{ nameOf(senders[0]) }}</span>
          {{ __('and {0} others', [String(senders.length - 1)]) }}?
        </template>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button variant="outline" :label="__('No')" @click="emit('deny')" />
        <div class="flex items-center">
          <Button
            variant="solid"
            :class="{ '!rounded-r-none': moreAnswers.length }"
            :label="__('Yes')"
            @click="emit('allow')"
          />
          <Dropdown v-if="moreAnswers.length" :options="moreAnswers" align="end">
            <Button
              variant="solid"
              class="!rounded-l-none border-l border-white/20 !px-1.5 dark:border-black/20"
              :aria-label="__('More ways to say yes')"
            >
              <template #icon><ChevronDown class="size-4" /></template>
            </Button>
          </Dropdown>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'
import { ChevronDown, UserRoundSearch } from 'lucide-vue-next'
import { computed } from 'vue'

type Sender = { email: string; name?: string }

/**
 * `senders`: who the thread is waiting on, in the order they first wrote. `domains`: the '@domain's
 * among them worth offering to trust.
 */
const { senders, domains = [] } = defineProps<{ senders: Sender[]; domains?: string[] }>()
const emit = defineEmits<{
  allow: []
  allowOne: [email: string]
  allowDomain: [domain: string]
  deny: []
}>()

const nameOf = (sender: Sender) => sender.name || sender.email
const emails = computed(() => senders.map((sender) => sender.email).join(', '))

// Behind the arrow: each person on their own, when there is more than one, then each organisation
// they write from.
const moreAnswers = computed(() =>
  [
    senders.length > 1
      ? senders.map((sender) => ({
          label: __('Yes to {0} only', [nameOf(sender)]),
          onClick: () => emit('allowOne', sender.email),
        }))
      : [],
    domains.map((domain) => ({
      label: __('Mark {0} as trusted', [domain.slice(1)]),
      onClick: () => emit('allowDomain', domain),
    })),
  ]
    .filter((options) => options.length)
    .map((options) => ({ group: '', options })),
)
</script>
