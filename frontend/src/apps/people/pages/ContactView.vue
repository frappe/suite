<template>
  <DashboardLayout v-if="contact.data" area="people" :breadcrumbs="breadcrumbs">
    <template #actions>
      <Dropdown :options="DROPDOWN_OPTIONS">
        <Button icon="lucide-more-horizontal" class="text-ink-gray-5" />
      </Dropdown>
    </template>
    <template #default>
      <div class="grid grid-cols-2 gap-5">
        <DashboardCard
          :title="__('General Information')"
          :button-label="__('Edit')"
          class="h-[14.5rem] max-sm:col-span-2"
          @action="showEditGeneral = true"
        >
          <InformationField :label="__('Name')" :value="contact.data.full_name ?? undefined" />
          <InformationField :label="__('Kind')" :value="capitalize(contact.data.kind ?? '')" />
          <InformationField
            :label="__('Created On')"
            :value="dayjs(contact.data.created_at).format('MMM D YYYY, h:mm A')"
          />
          <InformationField
            :label="__('Updated On')"
            :value="dayjs(contact.data.updated_at).format('MMM D YYYY, h:mm A')"
          />
        </DashboardCard>

        <DashboardCard
          :title="__('Address Books')"
          class="h-[14.5rem] max-sm:col-span-2"
          @action="showAddAddressBook = true"
        >
          <ListView
            ref="addressBooksList"
            :columns="ADDRESS_BOOK_COLUMNS"
            :rows="contact.data.address_books"
            row-key="address_book_id"
            :options="{
              emptyState: { title: '', description: __('No address books.') },
            }"
            class="flex-1 overflow-auto p-4"
          >
            <ListHeader />
            <ListRows v-if="contact.data.address_books.length" />
            <ListEmptyState v-else />
            <ListSelectBanner>
              <template #actions>
                <Button
                  variant="ghost"
                  :label="__('Remove')"
                  theme="red"
                  @click="showRemoveAddressBooks = true"
                />
              </template>
            </ListSelectBanner>
          </ListView>
        </DashboardCard>

        <DashboardCard
          :title="__('Emails')"
          class="col-span-2 h-[14.5rem]"
          @action="showAddEmail = true"
        >
          <ListView
            ref="emailsList"
            :columns="EMAIL_COLUMNS"
            :rows="contact.data.emails.map((c) => ({ ...c, type: capitalize(c.type ?? '') }))"
            row-key="address"
            :options="{ emptyState: { title: '', description: __('No emails.') } }"
            class="flex-1 overflow-auto p-4"
          >
            <ListHeader />
            <ListRows v-if="contact.data.emails.length" />
            <ListEmptyState v-else />
            <ListSelectBanner>
              <template #actions>
                <Button
                  variant="ghost"
                  :label="__('Remove')"
                  theme="red"
                  @click="showRemoveEmails = true"
                />
              </template>
            </ListSelectBanner>
          </ListView>
        </DashboardCard>

        <DashboardCard
          :title="__('Phones')"
          class="col-span-2 h-[14.5rem]"
          @action="showAddPhone = true"
        >
          <ListView
            ref="phonesList"
            :columns="PHONE_COLUMNS"
            :rows="contact.data.phones.map((p) => ({ ...p, type: capitalize(p.type ?? '') }))"
            row-key="number"
            :options="{ emptyState: { title: '', description: __('No phones.') } }"
            class="flex-1 overflow-auto p-4"
          >
            <ListHeader />
            <ListRows v-if="contact.data.phones.length" />
            <ListEmptyState v-else />
            <ListSelectBanner>
              <template #actions>
                <Button
                  variant="ghost"
                  :label="__('Remove')"
                  theme="red"
                  @click="showRemovePhones = true"
                />
              </template>
            </ListSelectBanner>
          </ListView>
        </DashboardCard>

        <DashboardCard
          :title="__('Addresses')"
          class="col-span-2 h-[14.5rem]"
          @action="showAddAddress = true"
        >
          <ListView
            ref="addressesList"
            :columns="ADDRESS_COLUMNS"
            :rows="contact.data.addresses.map((a) => ({ ...a, type: capitalize(a.type ?? '') }))"
            row-key="idx"
            :options="{ emptyState: { title: '', description: __('No addresses.') } }"
            class="flex-1 overflow-auto p-4"
          >
            <ListHeader />
            <ListRows v-if="contact.data.addresses.length" />
            <ListEmptyState v-else />
            <ListSelectBanner>
              <template #actions>
                <Button
                  variant="ghost"
                  :label="__('Remove')"
                  theme="red"
                  @click="showRemoveAddresses = true"
                />
              </template>
            </ListSelectBanner>
          </ListView>
        </DashboardCard>
      </div>
    </template>
  </DashboardLayout>

  <EditContactModal
    v-if="contact.data"
    v-model="showEditGeneral"
    :full-name="contact.data.full_name ?? undefined"
    :kind="contact.data.kind"
    :save="saveGeneral"
  />
  <AddContactAddressBookModal
    v-if="contact.data"
    v-model="showAddAddressBook"
    :save="addAddressBook"
  />
  <AddContactEmailModal v-if="contact.data" v-model="showAddEmail" :save="addEmail" />
  <AddContactPhoneModal v-if="contact.data" v-model="showAddPhone" :save="addPhone" />
  <AddContactAddressModal v-if="contact.data" v-model="showAddAddress" :save="addAddress" />
  <Dialog v-model:open="showDeleteContact" v-bind="deleteContactOptions" />
  <Dialog v-model:open="showRemoveAddressBooks" v-bind="removeAddressBooksOptions" />
  <Dialog v-model:open="showRemoveEmails" v-bind="removeEmailsOptions" />
  <Dialog v-model:open="showRemovePhones" v-bind="removePhonesOptions" />
  <Dialog v-model:open="showRemoveAddresses" v-bind="removeAddressesOptions" />
</template>

<script setup lang="ts">
import dayjs from 'dayjs/esm'
import { Button, Dialog, Dropdown, usePageMeta } from 'frappe-ui'
import {
  ListEmptyState,
  ListHeader,
  ListRows,
  ListSelectBanner,
  ListView,
} from 'frappe-ui/experimental'
import { Trash2 } from 'lucide-vue-next'
import { capitalize, computed, ref, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import AddContactAddressBookModal from '@/apps/people/components/Modals/AddContactAddressBookModal.vue'
import AddContactAddressModal from '@/apps/people/components/Modals/AddContactAddressModal.vue'
import AddContactEmailModal from '@/apps/people/components/Modals/AddContactEmailModal.vue'
import AddContactPhoneModal from '@/apps/people/components/Modals/AddContactPhoneModal.vue'
import EditContactModal from '@/apps/people/components/Modals/EditContactModal.vue'
import { raiseToast } from '@/apps/people/utils'
import DashboardCard from '@/components/dashboard/DashboardCard.vue'
import DashboardLayout from '@/components/dashboard/DashboardLayout.vue'
import InformationField from '@/components/dashboard/InformationField.vue'
import { appPageMeta } from '@/utils/documentTitle'

const { accountId, contactName } = defineProps<{ accountId: string; contactName: string }>()

const router = useRouter()

const showEditGeneral = ref(false)
const showAddAddressBook = ref(false)
const showAddEmail = ref(false)
const showAddPhone = ref(false)
const showAddAddress = ref(false)
const showRemoveAddressBooks = ref(false)
const showRemoveEmails = ref(false)
const showRemovePhones = ref(false)
const showRemoveAddresses = ref(false)
const showDeleteContact = ref(false)

const contact = useQuery(api.mail.contacts.get, () => ({ account: accountId, id: contactName }))
const updateContact = useMutation(api.mail.contacts.update)
const removeContact = useMutation(api.mail.contacts.delete)
type Changes = InputOf<typeof api.mail.contacts.update>['changes']

async function saveChanges(changes: Changes): Promise<void> {
  await updateContact.run({ account: accountId, id: contactName, changes })
  raiseToast(__('Contact updated.'))
}
async function saveGeneral(value: { fullName: string; kind: string }) {
  await saveChanges({ full_name: value.fullName, kind: value.kind })
}
async function addAddressBook(id: string) {
  await addToBook.run({ account: accountId, ids: [contactName], address_book_id: id })
}
const addToBook = useMutation(api.mail.contacts.addToBook)
async function addEmail(value: NonNullable<Changes['emails']>[number]) {
  await saveChanges({ emails: [...(contact.data?.emails ?? []), value] })
}
async function addPhone(value: NonNullable<Changes['phones']>[number]) {
  await saveChanges({ phones: [...(contact.data?.phones ?? []), value] })
}
async function addAddress(value: NonNullable<Changes['addresses']>[number]) {
  await saveChanges({ addresses: [...(contact.data?.addresses ?? []), value] })
}
async function deleteContact() {
  try {
    await removeContact.run({ account: accountId, ids: [contactName] })
    showDeleteContact.value = false
    raiseToast(__('Contact deleted.'))
    await router.push({ name: 'people-contacts', params: { accountId } })
  } catch {
    /* Keep the dialog open after refusal. */
  }
}

const deleteContactOptions = computed(() => ({
  title: __('Delete Contact'),
  message: __('Are you sure you want to delete the contact for {0}?', [contact.data?.full_name]),
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [{ label: __('Confirm'), variant: 'solid' as const, onClick: deleteContact }],
}))

const addressBooksList = useTemplateRef('addressBooksList')
const removeAddressBooksOptions = computed(() => ({
  title: __('Remove from Address Books'),
  message: __('Are you sure you want to remove this contact from the selected address books?'),
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      onClick: async () => {
        try {
          await saveChanges({
            address_books: (contact.data?.address_books ?? []).filter(
              (row) => !addressBooksList.value?.selections.has(row.address_book_id),
            ),
          })
          addressBooksList.value?.toggleAllRows()
          showRemoveAddressBooks.value = false
        } catch {
          /* Keep the dialog open after refusal. */
        }
      },
    },
  ],
}))

const emailsList = useTemplateRef('emailsList')
const removeEmailsOptions = computed(() => ({
  title: __('Remove Emails'),
  message: __('Are you sure you want to remove the selected emails?'),
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      onClick: async () => {
        try {
          await saveChanges({
            emails: (contact.data?.emails ?? []).filter(
              (row) => !emailsList.value?.selections.has(row.address),
            ),
          })
          emailsList.value?.toggleAllRows()
          showRemoveEmails.value = false
        } catch {
          /* Keep the dialog open after refusal. */
        }
      },
    },
  ],
}))

const phonesList = useTemplateRef('phonesList')
const removePhonesOptions = computed(() => ({
  title: __('Remove Phones'),
  message: __('Are you sure you want to remove the selected phones?'),
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      onClick: async () => {
        try {
          await saveChanges({
            phones: (contact.data?.phones ?? []).filter(
              (row) => !phonesList.value?.selections.has(row.number),
            ),
          })
          phonesList.value?.toggleAllRows()
          showRemovePhones.value = false
        } catch {
          /* Keep the dialog open after refusal. */
        }
      },
    },
  ],
}))

const addressesList = useTemplateRef('addressesList')
const removeAddressesOptions = computed(() => ({
  title: __('Remove Addresses'),
  message: __('Are you sure you want to remove the selected addresses?'),
  icon: 'lucide-alert-triangle',
  theme: 'amber' as const,
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      onClick: async () => {
        try {
          await saveChanges({
            addresses: (contact.data?.addresses ?? []).filter(
              (row) => !addressesList.value?.selections.has(row.idx),
            ),
          })
          addressesList.value?.toggleAllRows()
          showRemoveAddresses.value = false
        } catch {
          /* Keep the dialog open after refusal. */
        }
      },
    },
  ],
}))

const contactDisplay = computed(
  () => contact.data?.full_name || contact.data?.emails[0]?.address || contactName,
)

usePageMeta(() => appPageMeta(contactDisplay.value, 'People'))

const breadcrumbs = computed(() => [
  { label: __('Contacts'), route: '/mail/contacts' },
  { label: contactDisplay.value },
])

const ADDRESS_BOOK_COLUMNS = [{ label: __('Name'), key: 'address_book_name' }]

const EMAIL_COLUMNS = [
  { label: __('Address'), key: 'address' },
  { label: __('Type'), key: 'type' },
  { label: __('Label'), key: 'label' },
]

const PHONE_COLUMNS = [
  { label: __('Number'), key: 'number' },
  { label: __('Type'), key: 'type' },
  { label: __('Label'), key: 'label' },
]

const ADDRESS_COLUMNS = [
  { label: __('Type'), key: 'type', width: '15%' },
  { label: __('Street'), key: 'street', width: '20%' },
  { label: __('Locality'), key: 'locality', width: '20%' },
  { label: __('Region'), key: 'region', width: '15%' },
  { label: __('Postcode'), key: 'postcode', width: '15%' },
  { label: __('Country'), key: 'country', width: '15%' },
]

const DROPDOWN_OPTIONS = [
  {
    label: __('Delete'),
    onClick: () => (showDeleteContact.value = true),
    icon: Trash2,
  },
]
</script>
