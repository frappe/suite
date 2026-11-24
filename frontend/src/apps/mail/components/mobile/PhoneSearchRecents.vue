<template>
  <!-- A phone's search before anything is asked: the searches run last, each a tap from running
       again. With none, a word on what search looks through. -->
  <div v-if="recentSearches.length" class="pb-24">
    <div class="flex items-center justify-between pb-1 pl-4 pr-3 pt-2">
      <span class="text-ink-gray-5 text-sm">{{ __('Recent searches') }}</span>
      <Button variant="ghost" :label="__('Clear')" @click="clearRecentSearches" />
    </div>
    <div v-for="recent in recentSearches" :key="recent.at" class="flex items-center pr-2">
      <button
        type="button"
        class="active:bg-surface-gray-2 flex min-h-12 min-w-0 flex-1 items-center gap-3 pl-4 pr-2"
        @click="runAgain(recent)"
      >
        <History class="text-ink-gray-5 size-5 shrink-0" />
        <span class="text-ink-gray-8 truncate text-lg">{{ recent.label }}</span>
      </button>
      <button
        type="button"
        :aria-label="__('Forget this search')"
        class="text-ink-gray-5 active:bg-surface-gray-2 flex size-10 shrink-0 items-center justify-center rounded-full"
        @click="forgetSearch(recent)"
      >
        <X class="size-4" />
      </button>
    </div>
  </div>
  <p v-else class="text-ink-gray-5 text-p-sm px-8 pt-16 text-center">
    {{ __('Search finds words in the subject, the people and the body of your mail.') }}
  </p>
</template>

<script setup lang="ts">
import { Button } from 'frappe-ui'
import { History, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import type { MailRecentSearch } from '@/apps/mail/components/CommandPalette/types'
import { useRecentMailSearches } from '@/apps/mail/composables/recentMailSearches'
import { userStore } from '@/apps/mail/stores/user'
import { mailSearchRoute } from '@/apps/mail/utils/composables'
import { translate as __ } from '@/platform/translation'

const router = useRouter()
const store = userStore()
const { recentSearches, forgetSearch, clearRecentSearches } = useRecentMailSearches()

// As it ran, but for a folder from another account: a folder's id names one account's folder.
const runAgain = (recent: MailRecentSearch) => {
  const { inMailbox, ...query } = recent.filters
  if (inMailbox && recent.account === store.accountId) query.inMailbox = inMailbox
  if (recent.text) query.text = recent.text
  void router.replace(mailSearchRoute(store.accountId, query))
}
</script>
