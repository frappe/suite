<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('New Contact'),
      actions: [
        {
          label: __('Save'),
          variant: 'solid' as const,
          disabled: !(contact.full_name && contact.kind && contact.address_book_ids.length),
          onClick: createContactSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="contact.full_name"
          :label="__('Name')"
          :placeholder="__('John Doe')"
        />
        <FormControl
          v-model="contact.kind"
          type="select"
          :label="__('Kind')"
          :options="KIND_OPTIONS"
        />
        <div class="space-y-1.5">
          <label class="text-ink-gray-5 block text-xs">{{ __('Address Books') }}</label>
          <MultiSelect
            v-model="contact.address_book_ids"
            :options="
              (store.addressBooks.data ?? []).map((ab) => ({
                label: ab._name,
                value: ab.id,
              }))
            "
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl, MultiSelect } from 'frappe-ui'
import { reactive, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, useMutation } from '@/api'
import { userStore } from '@/apps/people/stores/user'
import { raiseToast } from '@/apps/people/utils'

const show = defineModel<boolean>()

const store = userStore()
const router = useRouter()

const defaultContact = {
  address_book_ids: [] as string[],
  full_name: '',
  kind: 'Individual',
}

const contact = reactive({ ...defaultContact })

const createContact = useMutation(api.mail.contacts.create)
async function createContactSubmit() {
  const account = store.accountId
  try {
    const id = await createContact.run({ ...contact, account })
    show.value = false
    raiseToast(__('Contact created.'))
    await router.push({ name: 'people-contact', params: { accountId: account, contactName: id } })
  } catch {
    /* Keep the draft open after refusal. */
  }
}

watch(show, (val) => {
  if (val) {
    const book = (store.addressBooks.data ?? []).find((ab) => ab.default)?.id
    Object.assign(contact, { ...defaultContact, address_book_ids: book ? [book] : [] })
  }
})

const KIND_OPTIONS = [
  { label: __('Individual'), value: 'Individual' },
  { label: __('Group'), value: 'Group' },
]
</script>
