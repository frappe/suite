<template>
  <!-- Who a phone's search is from, or to: a name or an address typed in, the people it matches
       under it, as a recipient field suggests them. What is typed goes as it is when no one matches.
       The sheet is tall from the start and stays so: sized to its matches, it grew and shrank with
       every letter typed, and the field at its top went up and down with it. The field stays at
       the top while the matches scroll under it. -->
  <BottomSheet v-model:open="open" :title="title">
    <div class="min-h-[75dvh] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div class="bg-surface-base sticky top-0 z-10 px-1 pb-2">
        <input
          ref="field"
          v-model="typed"
          type="text"
          enterkeyhint="done"
          autocapitalize="off"
          :placeholder="__('Name or address')"
          :aria-label="__('Name or address')"
          class="bg-surface-gray-2 text-ink-gray-8 placeholder-ink-gray-4 h-10 w-full rounded-full border-none px-4 text-lg focus:ring-0"
          @keydown.enter.prevent="typed.trim() && pick(typed.trim())"
        />
      </div>
      <button v-if="value" :class="ROW" @click="pick(undefined)">
        <span class="text-ink-gray-8 flex-1 truncate text-left">{{ __('Anyone') }}</span>
      </button>
      <button
        v-for="contact in contacts"
        :key="contact.email"
        :class="ROW"
        @click="pick(contact.email)"
      >
        <Avatar
          :image="contact.user_image ?? undefined"
          :label="contact.name || contact.email"
          size="lg"
        />
        <ContactOption
          class="min-w-0 flex-1 text-left"
          :contact="{ email: contact.email, display_name: contact.name || '' }"
          :query="asked"
        />
        <Check v-if="contact.email === value" class="text-ink-gray-6 size-4 shrink-0" />
      </button>
      <button
        v-if="typed.trim() && !contacts.length && !lookingUp"
        :class="ROW"
        @click="pick(typed.trim())"
      >
        <span class="text-ink-gray-8 flex-1 truncate text-left">
          {{ typedLabel }}
        </span>
      </button>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { Avatar, BottomSheet } from 'frappe-ui'
import { Check } from 'lucide-vue-next'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import { api, useQuery } from '@/api'
import ContactOption from '@/apps/mail/components/Controls/ContactOption.vue'
import { userStore } from '@/apps/mail/stores/user'
import { translate as __ } from '@/platform/translation'

const { side, value } = defineProps<{
  /** Which side of the mail the person is on. */
  side: 'from' | 'to'
  value?: string
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ pick: [from: string | undefined] }>()

const ROW =
  'active:bg-surface-gray-1 flex min-h-12 w-full items-center gap-3 rounded-6 px-3 py-2 text-base'

const store = userStore()
const field = useTemplateRef<HTMLInputElement>('field')
const typed = ref('')
const asked = refDebounced(typed, 300)
const contactSearch = useQuery(api.mail.contacts.suggest, () =>
  open.value && asked.value.trim() ? { account: store.accountId, text: asked.value.trim() } : false,
)
const contacts = computed(() => (asked.value.trim() ? (contactSearch.data ?? []) : []))
const title = computed(() => (side === 'from' ? __('From') : __('To')))
const typedLabel = computed(() =>
  side === 'from'
    ? __('Mail from “{0}”', [typed.value.trim()])
    : __('Mail to “{0}”', [typed.value.trim()]),
)
const lookingUp = computed(() => typed.value !== asked.value || contactSearch.status === 'pending')

// Opened afresh each time, with the caret in the field.
watch(open, async (isOpen) => {
  if (!isOpen) return
  typed.value = ''
  await nextTick()
  field.value?.focus()
})

const pick = (from: string | undefined) => {
  emit('pick', from)
  open.value = false
}
</script>
