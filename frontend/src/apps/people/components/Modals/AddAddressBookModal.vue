<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('New Address Book'),
      actions: [
        {
          label: __('Save'),
          variant: 'solid' as const,
          disabled: !addressBook.name,
          onClick: createAddressBookSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="addressBook.name"
          :label="__('Name')"
          :placeholder="__('Work Contacts')"
        />
        <FormControl
          v-model="addressBook.description"
          type="textarea"
          :label="__('Description')"
          :placeholder="__('All my work-related contacts')"
        />
        <FormControl v-model="addressBook.default" type="checkbox" :label="__('Set as Default')" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { reactive, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, useMutation } from '@/api'
import { userStore } from '@/apps/people/stores/user'
import { raiseToast } from '@/apps/people/utils'

const show = defineModel<boolean>()

const store = userStore()
const router = useRouter()

const defaultAddressBook = {
  name: '',
  description: '',
  default: false,
}

const addressBook = reactive({ ...defaultAddressBook })

const createAddressBook = useMutation(api.mail.addressBooks.create)
async function createAddressBookSubmit() {
  const account = store.accountId
  const id = await createAddressBook.run({ ...addressBook, account })
  show.value = false
  raiseToast(__('Address book created.'))
  await router.push({
    name: 'people-address-book',
    params: { accountId: account, addressBookName: id },
  })
}

watch(show, (val) => {
  if (val) Object.assign(addressBook, defaultAddressBook)
})
</script>
