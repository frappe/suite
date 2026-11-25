<template>
  <!--
	  Profile as a page — a destination of the sidebar sheet rather than a sheet or a
	  dialog over whatever was behind it — with the app's settings list as its contents,
	  so the tab lands somewhere instead of covering something. Mail and the calendar
	  draw the same page; what differs between them is handed in.
	-->
  <div class="relative flex h-full min-h-0 flex-col">
    <slot name="header">
      <header class="flex h-14 shrink-0 items-center border-b px-4">
        <h1 class="text-xl font-medium text-ink-gray-9">{{ __('Settings') }}</h1>
      </header>
    </slot>

    <!-- space-y, not a flex column with a gap: flex items in a scroller compress to
		     fit before the scroller ever scrolls. -->
    <div
      class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"
    >
      <!-- The identity card is the screen's subject, so it stands outside the groups
			     and opens the Profile tab the list leaves out. -->
      <button
        class="active:bg-surface-gray-1 flex w-full items-center gap-3.5 rounded-6 px-1 py-3.5"
        @click="openSettingsPage('account.profile')"
      >
        <Avatar :label="fullName" :image="avatar ?? undefined" size="2xl" class="size-14" />
        <div class="min-w-0 flex-1 text-left">
          <div class="text-ink-gray-9 truncate text-md !font-semibold">{{ fullName }}</div>
          <div class="text-ink-gray-5 mt-0.5 truncate text-sm">{{ loginId }}</div>
        </div>
        <ChevronRight class="text-ink-gray-4 size-4 shrink-0" />
      </button>

      <!-- Which account is in use, under the person it belongs to, and a tap opens the rest in a
			     sheet to switch, as the sidebar's account submenu does on desktop. No heading: an
			     "Accounts" card over the settings' own "Account" group read as the same thing twice. -->
      <MobileSettingsCard v-if="accounts.length > 1">
        <!-- An icon as every row here has: the person's avatar is already on the card above. -->
        <MobileSettingsRow
          :icon="ArrowLeftRight"
          :label="__('Switch account')"
          @click="pickingAccount = true"
        >
          <template #trailing>
            <span class="text-ink-gray-5 min-w-0 max-w-[50%] shrink truncate">
              {{ allAccounts?.active ? __('All accounts') : (current?._name ?? '') }}
            </span>
          </template>
        </MobileSettingsRow>
      </MobileSettingsCard>

      <BottomSheet v-model:open="pickingAccount" :title="__('Accounts')">
        <!-- In the sidebar's order: the reader's own account first, the rest as they come, then
             every account at once where the app offers it. -->
        <div class="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <MobileSettingsRow
            v-for="account in orderedAccounts"
            :key="account.id"
            class="rounded-6"
            :label="account._name ?? ''"
            :chevron="false"
            @click="pick(() => emit('switchAccount', account.id))"
          >
            <template #leading>
              <Avatar :label="account._name ?? ''" size="md" />
            </template>
            <!-- The tick on the account in use; on any other, what is unread there. -->
            <template #trailing>
              <Check
                v-if="!allAccounts?.active && account.id === accountId"
                class="text-ink-gray-6 size-4 shrink-0"
              />
              <span v-else-if="unread?.[account.id]" class="text-ink-gray-5 shrink-0 tabular-nums">
                {{ accountUnreadLabel(unread[account.id]!) }}
                <span class="sr-only">{{ __('unread') }}</span>
              </span>
            </template>
          </MobileSettingsRow>
          <MobileSettingsRow
            v-if="allAccounts"
            class="rounded-6"
            :label="__('All accounts')"
            :chevron="false"
            @click="pick(() => emit('switchToAll'))"
          >
            <template #leading>
              <span :class="ALL_ACCOUNTS_ICON">
                <span class="lucide-users size-3.5" aria-hidden="true" />
              </span>
            </template>
            <template #trailing>
              <Check v-if="allAccounts.active" class="text-ink-gray-6 size-4 shrink-0" />
              <span v-else-if="allAccounts.unread" class="text-ink-gray-5 shrink-0 tabular-nums">
                {{ accountUnreadLabel(allAccounts.unread) }}
                <span class="sr-only">{{ __('unread') }}</span>
              </span>
            </template>
          </MobileSettingsRow>
        </div>
      </BottomSheet>

      <!-- The Suite settings list, as the Settings drill-in shows it, as one card: here it is
			     only the account's tabs and this app's. A row opens its tab in Settings. -->
      <SettingsList
        :groups="ownGroups"
        :exclude="excluded"
        flat
        @open="(tab) => openSettingsPage(tab.id as SettingsTabId)"
      />

      <!-- This device's notifications. -->
      <MobileSettingsCard v-if="push.available.value">
        <MobileSettingsRow
          :icon="Bell"
          :label="__('Notifications')"
          :chevron="false"
          @click="toggleNotifications"
        >
          <template #trailing>
            <Switch
              :model-value="push.enabled.value"
              :disabled="switching"
              @click.stop
              @update:model-value="toggleNotifications"
            />
          </template>
        </MobileSettingsRow>
      </MobileSettingsCard>

      <!-- What the app has to say about the account beside its settings, such as Mail's storage. -->
      <slot name="account" />

      <!-- Its own card: the destructive row is kept apart from the rest. -->
      <MobileSettingsCard>
        <MobileSettingsRow
          :icon="LogOut"
          :label="__('Log Out')"
          theme="red"
          :chevron="false"
          @click="showLogoutConfirm = true"
        />
      </MobileSettingsCard>
    </div>

    <!-- The row rests at the bottom of a scroll rather than behind a deliberate
		     gesture, so it asks first. -->
    <AdaptiveDialog
      v-model:open="showLogoutConfirm"
      v-bind="{
        title: __('Log Out'),
        message: __('Are you sure you want to log out?'),
        icon: 'lucide-alert-triangle',
        theme: 'amber',
        actions: [{ label: __('Log Out'), theme: 'red', onClick: logout.submit }],
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { Avatar, BottomSheet, Switch } from 'frappe-ui'
import { ArrowLeftRight, Bell, Check, ChevronRight, LogOut } from 'lucide-vue-next'
import { computed, inject, onMounted, ref, useSlots } from 'vue'

// The two shells are mail's: a settings card and its rows. They carry no mail in them.
import MobileSettingsCard from '@/apps/mail/components/mobile/MobileSettingsCard.vue'
import MobileSettingsRow from '@/apps/mail/components/mobile/MobileSettingsRow.vue'
import { accountUnreadLabel, type AccountUnread } from '@/platform/area-sidebar'
import { toast } from '@/platform/feedback'
import AdaptiveDialog from '@/platform/feedback/AdaptiveDialog.vue'
import { useDevicePush } from '@/platform/pwa'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'
import type { SettingsTabId } from '@/shell/settings/settings'
import SettingsList from '@/shell/settings/SettingsList.vue'
import { openSettingsPage, useSettingsGroups } from '@/shell/settings/useSettingsDialog'

const props = defineProps<{
  accounts: { id: string; _name: string | null; is_personal?: boolean }[]
  accountId?: string
  /**
   * Offers every account at once below the accounts, whether that is what is showing, and what is
   * unread across them all.
   */
  allAccounts?: { active: boolean; unread?: number }
  /** What is unread in each account, by account id, shown on the accounts not in use. */
  unread?: AccountUnread
  logout: { submit: () => void }
  /**
   * The app this page is the Profile of. Its settings are listed with the account's and the
   * workspace's, not every app's: on a phone each app is one of its own (ticket 047).
   */
  app?: string
}>()

const emit = defineEmits<{ switchAccount: [accountId: string]; switchToAll: [] }>()

const current = computed(() => props.accounts.find((account) => account.id === props.accountId))
const ALL_ACCOUNTS_ICON =
  'bg-surface-gray-2 text-ink-gray-6 flex size-6 shrink-0 items-center justify-center rounded-full'
// The sheet closes as the switch is made, so the page shows the account it switched to.
const pickingAccount = ref(false)
const pick = (choose: () => void) => {
  pickingAccount.value = false
  choose()
}

const orderedAccounts = computed(() =>
  [...props.accounts].sort((a, b) => Number(!!b.is_personal) - Number(!!a.is_personal)),
)

// A group's tabs share its app's prefix (`mail.inbox`, `account.profile`)
// The identity card stands for Profile; an app that shows its own storage on the page (Mail) leaves
// out the Storage tab that would say it again.
const slots = useSlots()
const excluded = computed(() =>
  slots.account ? ['account.profile', 'account.storage'] : ['account.profile'],
)

const ownGroups = computed(() => {
  const groups = settings.groups.value
  if (!props.app) return groups
  const kept = ['account', 'workspace', props.app]
  return groups.filter((group) => kept.includes(group.tabs[0]?.id.split('.')[0] ?? ''))
})

interface ProfileUser {
  data?: { user_image?: string | null; full_name?: string; name?: string; email?: string } | null
}
const user = inject<ProfileUser>('$user')

// The same list the Settings dialog shows, so the two cannot drift.
const settings = useSettingsGroups()
onMounted(() => void settings.refresh())

const showLogoutConfirm = ref(false)

const push = useDevicePush()
const switching = ref(false)
const toggleNotifications = async () => {
  if (switching.value) return
  switching.value = true
  try {
    if (push.enabled.value) await push.disable()
    else if (!(await push.enable()))
      toast.error(__('Notifications are blocked for this site in the browser settings'))
  } catch {
    toast.error(__('Could not enable notifications'))
  } finally {
    switching.value = false
  }
}

// The signed-in user, as the session has it: a name or picture changed in Profile shows here as
// soon as it is saved, where the app's own copy of the user would keep the old one.
const session = useSession()
const fullName = computed(() => session.user.value?.fullName ?? user?.data?.full_name ?? '')
const avatar = computed(() => session.user.value?.avatar ?? user?.data?.user_image ?? null)
// The login id, not the active account: the card is who you are signed in as, and the
// accounts — any of which could be active — are the list right below it.
const loginId = computed(() => user?.data?.name ?? '')
</script>
