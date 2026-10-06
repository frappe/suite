<template>
  <!-- Mail's own sidebar, in the shell's sidebar slot on a desktop and in the
	     bottom nav's sheet on a phone. The page header's folder button and a tap
	     on the active Mail tab open the sheet. -->
  <AreaSidebar area="mail" :title="__('Mail')">
    <!-- The active account leads. Its menu lists the accounts, and every account at once. With
         one account, or on the dashboard, there is nothing to pick: it is just named. -->
    <SidebarSection class="!mt-0">
      <Dropdown v-if="accountMenu.length" :options="accountMenu" :match-trigger-width="true">
        <SidebarItem :label="subtitle || __('Account')" icon="lucide-circle-user-round">
          <template #suffix>
            <span
              class="lucide-chevrons-up-down mr-2 size-3.5 text-ink-gray-5"
              aria-hidden="true"
            />
          </template>
        </SidebarItem>
      </Dropdown>
      <SidebarItem v-else :label="subtitle || __('Account')" icon="lucide-circle-user-round" />
    </SidebarSection>
    <SidebarSection
      v-for="section in sidebarItems"
      :key="section.key ?? section.label"
      :label="section.label"
      :collapsible="section.collapsible"
      :collapsed="isSectionCollapsed(section)"
      class="!mt-4"
      @update:collapsed="(collapsed) => setSectionCollapsed(section.key, collapsed)"
    >
      <SidebarItem
        v-for="item in section.items"
        :key="item.label"
        :label="item.label"
        :icon="item.icon"
        :route="item.to"
        :class="
          threadDrag.overMailbox.value === item.mailboxId && 'ring-2 ring-outline-gray-3 ring-inset'
        "
        :active="item.activeFor?.includes(activeKey)"
        :on-click="item.onClick"
        class="group"
        @dragover="onFolderDragOver($event, item)"
        @dragleave="onFolderDragLeave(item)"
        @drop="onFolderDrop($event, item)"
      >
        <template #suffix>
          <div class="flex items-center">
            <Dropdown v-if="item.menuOptions" :options="item.menuOptions">
              <Button variant="ghost" class="!bg-transparent" @click.stop>
                <template #icon>
                  <Ellipsis class="text-ink-gray-6 invisible h-4 w-4 group-hover:visible" />
                </template>
              </Button>
            </Dropdown>
            <span
              class="text-ink-gray-4 mr-2 text-sm"
              :class="{ 'group-hover:hidden': item.menuOptions }"
            >
              {{ item.suffix }}
            </span>
          </div>
        </template>
      </SidebarItem>
    </SidebarSection>

    <!-- Personal widgets (events, quota) are meaningless while administering the
		     server, and the phone's sheet is a folder switcher, not a dashboard. -->
    <AreaSidebarFooter v-if="showWidgets">
      <UpcomingEvents :is-collapsed="false" />
      <QuotaBar :is-collapsed="false" />
    </AreaSidebarFooter>
  </AreaSidebar>

  <FolderModal v-model="showFolderModal" :mailbox="selectedMailbox" />
  <DeleteFolderModal v-model="showDeleteMailbox" :mailbox="selectedMailbox" />
</template>

<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import ArrowLeft from '~icons/lucide/arrow-left'
import CalendarClock from '~icons/lucide/calendar-clock'
import CircleUserRound from '~icons/lucide/circle-user-round'
import Crown from '~icons/lucide/crown'
import Ellipsis from '~icons/lucide/ellipsis'
import Globe from '~icons/lucide/globe'
import House from '~icons/lucide/house'
import Lock from '~icons/lucide/lock'
import Megaphone from '~icons/lucide/megaphone'
import Plus from '~icons/lucide/plus'
import Settings from '~icons/lucide/settings'
import ShieldCheck from '~icons/lucide/shield-check'
import Star from '~icons/lucide/star'
import Trash2 from '~icons/lucide/trash-2'
import Users from '~icons/lucide/users'
import UsersRound from '~icons/lucide/users-round'
import { Button, Dropdown, SidebarItem, SidebarSection } from 'frappe-ui'
import { Icon } from 'frappe-ui/experimental'
import { computed, h, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import DeleteFolderModal from '@/apps/mail/components/Modals/DeleteFolderModal.vue'
import FolderModal from '@/apps/mail/components/Modals/FolderModal.vue'
import QuotaBar from '@/apps/mail/components/QuotaBar.vue'
import UpcomingEvents from '@/apps/mail/components/UpcomingEvents.vue'
import { useThreadDrag } from '@/apps/mail/composables/useThreadDrag'
import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import { SECONDARY_MAILBOX_ROLES, userStore } from '@/apps/mail/stores/user'
import type { MailboxData, UnifiedFolder } from '@/apps/mail/types'
import { getIcon, getMailboxName } from '@/apps/mail/utils'
import { useAccountSwitch, useScreenSize } from '@/apps/mail/utils/composables'
import { canMoveToMailbox } from '@/apps/mail/utils/mailboxTargets'
import {
  groupUnifiedFolders,
  isUnifiedRoute,
  mailboxIdForParam,
  mailboxParam,
  STARRED_FOLDER,
  unifiedFolderIcon,
  unifiedFolderRoute,
} from '@/apps/mail/utils/unifiedFolders'
import { accountSubmenu } from '@/composables/accountSubmenu'
import { AreaSidebar, AreaSidebarFooter } from '@/platform/area-sidebar'

const route = useRoute()
const router = useRouter()
const { isMobile } = useScreenSize()
const { switchAccount, switchToAll } = useAccountSwitch()

// Per-section open/closed state for collapsible sections, keyed by the section's
// stable `key` (labels are translated, so they can't be storage keys). More
// starts collapsed for new users; every toggle is remembered.
const collapsedSections = useStorage<Record<string, boolean>>('mail-sidebar-collapsed-sections', {
  more: true,
})
const setSectionCollapsed = (key: string | undefined, collapsed: boolean) => {
  if (key) collapsedSections.value[key] = collapsed
}
const isSectionCollapsed = (section: { key?: string }) =>
  !!section.key && !!collapsedSections.value[section.key]
const store = userStore()
const { mailboxes, unifiedFolders } = store

// "All accounts": the folder list is every account's, merged (see utils/unifiedFolders).
const isUnified = computed(() => isUnifiedRoute(route.name))

// What an item's `activeFor` is matched against: the open mailbox in an account, the open folder
// across all of them, and the route itself everywhere else.
const activeKey = computed(() => {
  if (route.name === 'mail-mailbox' || route.name === 'mail-mail')
    return mailboxIdForParam(route.params.mailbox, mailboxes.data)
  if (isUnified.value) return `unified:${route.params.folder}`
  return route.name
})

// ── Threads dropped onto a folder ─────────────────────────────────────────────────────────────────
// The rows are dragged in the view; the folders that take them are here. The move itself belongs to
// the view too — the sidebar only says which folder the cursor is over, and hands the drop back.
const threadDrag = useThreadDrag()

/**
 * Folders that can take a drop: exactly the ones the "Move to" menu offers, read from the same
 * predicate — and from the same membership, which the drag carries over from the list — so the two
 * lists cannot drift. That rules out the folders the dragged threads are already in, along with
 * Sent, Drafts and the Screener; Junk and Trash stay in, since handleMoveThreads reads those as
 * "mark as spam" and "delete", which is what dropping there means. Sidebar entries that are not
 * real mailboxes — Starred, Outbox, the merged folders — have no id and fall out on their own.
 */
const canDrop = (item: { mailboxId?: string }) =>
  threadDrag.isDragging.value &&
  !!mailboxes.data?.some((m: MailboxData) => m.id === item.mailboxId) &&
  canMoveToMailbox(item.mailboxId, threadDrag.filedIn.value, store.mailboxIds)

const onFolderDragOver = (e: DragEvent, item: { mailboxId?: string }) => {
  if (!canDrop(item)) return
  // Without preventDefault the browser refuses the drop and shows the "no" cursor.
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  threadDrag.overMailbox.value = item.mailboxId!
}

const onFolderDragLeave = (item: { mailboxId?: string }) => {
  if (threadDrag.overMailbox.value === item.mailboxId) threadDrag.overMailbox.value = ''
}

const onFolderDrop = (e: DragEvent, item: { mailboxId?: string }) => {
  if (!canDrop(item)) return
  e.preventDefault()
  threadDrag.drop(item.mailboxId!)
}

const user = store.userResource

const showFolderModal = ref(false)
const selectedMailbox = ref()
const showDeleteMailbox = ref(false)

// The account row shows the active mail account, not the Suite account [T010] — or that every
// account is showing at once.
const subtitle = computed(() =>
  isUnified.value
    ? __('All accounts')
    : (user.data?.accounts?.find((a) => a.id === store.accountId)?._name ?? ''),
)

const showWidgets = computed(
  () => !isMobile.value && user.data?.is_jmap_configured && !route.meta.isDashboard,
)

// Leave the dashboard for the active account's default mailbox (or the address
// books, in People, when no mailbox exists yet). Shared by the account menu item and the
// pinned "Back to Mail" sidebar item.
const goToMailbox = () => {
  const mailbox = mailboxes.data?.[0]?.id
  if (mailbox)
    router.push({
      name: 'mail-mailbox',
      params: { accountId: store.accountId, mailbox },
    })
  else
    router.push({
      name: 'people-address-books',
      params: { accountId: store.accountId },
    })
}

// The account menu: the reader's own account first, the rest as they come, then all of them at
// once. Empty when there is nothing to pick.
const accountMenu = computed(() =>
  (user.data?.accounts?.length ?? 0) > 1 && !route.meta.isDashboard
    ? accountSubmenu(user.data?.accounts ?? [], store.accountId, switchAccount, {
        label: __('All accounts'),
        active: isUnified.value,
        onSelect: switchToAll,
      })
    : [],
)

const dashboardItems = [
  {
    label: __('Directory'),
    items: [
      {
        label: __('Accounts'),
        icon: Users,
        to: { name: 'mail-accounts' },
        activeFor: ['mail-accounts', 'mail-invites', 'mail-account'],
      },
      {
        label: __('Groups'),
        icon: UsersRound,
        to: { name: 'mail-groups' },
        activeFor: ['mail-groups', 'mail-group'],
      },
      {
        label: __('Mailing Lists'),
        icon: Megaphone,
        to: { name: 'mail-mailing-lists' },
        activeFor: ['mail-mailing-lists', 'mail-mailing-list'],
      },
    ],
  },
  {
    label: __('Domains'),
    items: [
      {
        label: __('Domains'),
        icon: Globe,
        to: { name: 'mail-domains' },
        activeFor: ['mail-domains', 'mail-domain'],
      },
      {
        label: __('DMARC Reports'),
        icon: ShieldCheck,
        to: { name: 'mail-dmarc-reports' },
        activeFor: ['mail-dmarc-reports', 'mail-dmarc-report'],
      },
      {
        label: __('TLS Reports'),
        icon: Lock,
        to: { name: 'mail-tls-reports' },
        activeFor: ['mail-tls-reports', 'mail-tls-report'],
      },
    ],
  },
]

const mailboxItems = computed(
  () =>
    mailboxes.data
      // The Screener is listed even unsubscribed: it can't be hidden from Folder settings, and
      // Stalwart recreates it unsubscribed when the screening Sieve script brings it back.
      ?.filter(
        (mailbox: MailboxData) => mailbox.subscribed || mailbox.id === store.mailboxIds.screener,
      )
      ?.map((mailbox: MailboxData) => {
        // The Screening folder opens the dedicated Screener page, not the thread list.
        const isScreener = mailbox.id === store.mailboxIds.screener
        return {
          mailboxId: mailbox.id,
          label: getMailboxName(mailbox),
          icon: h(Icon, {
            name: getIcon(mailbox),
            class: mailbox.color ? FOLDER_ICON_COLOR_MAP[mailbox.color] : undefined,
          }),
          to: isScreener
            ? { name: 'mail-screener', params: { accountId: store.accountId } }
            : {
                name: 'mail-mailbox',
                params: {
                  accountId: store.accountId,
                  mailbox: mailboxParam(mailbox.id, mailboxes.data),
                },
              },
          suffix: mailbox.unread_threads ? String(mailbox.unread_threads) : '',
          activeFor: isScreener ? ['mail-screener', 'mail-screener-sender'] : [mailbox.id],
          menuOptions: isScreener
            ? undefined
            : [
                {
                  label: __('Configure'),
                  icon: Settings,
                  onClick: () => {
                    selectedMailbox.value = mailbox
                    showFolderModal.value = true
                  },
                },
                {
                  label: __('Delete'),
                  theme: 'red' as const,
                  icon: Trash2,
                  onClick: () => {
                    selectedMailbox.value = mailbox
                    showDeleteMailbox.value = true
                  },
                },
              ],
        }
      }) || [],
)

const screeningEnabled = computed(
  () =>
    !!store.userResource?.data?.accounts?.find((a) => a.id === store.accountId)?.enable_screening,
)

// The folder list of "All accounts", grouped as an account's is: system folders and Starred, then the
// custom folders, then Junk/Archive/Trash under More. Nothing account-bound — Outbox, the Screener,
// New Folder — has a merged form, so none of it is offered here.
const unifiedSidebarItems = computed(() => {
  const folders: UnifiedFolder[] = unifiedFolders.data ?? []
  const toItem = (folder: UnifiedFolder) => ({
    label: folder.name,
    icon: h(Icon, {
      name: unifiedFolderIcon(folder.slug, folders),
      class: folder.color ? FOLDER_ICON_COLOR_MAP[folder.color] : undefined,
    }),
    to: unifiedFolderRoute(folder.slug),
    activeFor: [`unified:${folder.slug}`],
    suffix: folder.unread_threads ? String(folder.unread_threads) : '',
  })
  const starredItem = {
    label: __('Starred'),
    icon: Star,
    to: unifiedFolderRoute(STARRED_FOLDER),
    activeFor: [`unified:${STARRED_FOLDER}`],
  }
  const { primary, custom, secondary } = groupUnifiedFolders(folders)

  return [
    { label: __('Default'), items: [...primary.map(toItem), starredItem] },
    ...(custom.length ? [{ label: __('Custom'), items: custom.map(toItem) }] : []),
    ...(secondary.length
      ? [{ label: __('More'), key: 'more', items: secondary.map(toItem), collapsible: true }]
      : []),
  ]
})

const sidebarItems = computed(() => {
  if (isUnified.value) return unifiedSidebarItems.value

  if (route.meta.isDashboard) {
    // A pinned, unlabelled group at the top of the nav: the exit back to the
    // inbox (previously buried in the header dropdown) and the Overview home.
    // Admins without a JMAP account (e.g. System Managers) have no inbox to
    // go back to, so the exit is omitted for them.
    const pinned = [
      ...(user.data?.is_jmap_configured
        ? [
            {
              label: __('Back to Mail'),
              icon: ArrowLeft,
              onClick: goToMailbox,
            },
          ]
        : []),
      {
        label: __('Overview'),
        icon: House,
        to: { name: 'mail-overview' },
        activeFor: ['mail-overview'],
      },
    ]
    return [{ label: '', items: pinned }, ...dashboardItems]
  }

  // Screening is a roleless folder; it gets its own nameless group pinned to the top of the
  // sidebar, separate from the default and custom mailboxes.
  const isScreening = (item: { mailboxId?: string }) =>
    !!store.mailboxIds.screener && item.mailboxId === store.mailboxIds.screener

  const screenerItem = mailboxItems.value.find((item) => isScreening(item))

  const roleOf = (item: { mailboxId?: string }) =>
    mailboxes.data?.find((m) => m.id === item.mailboxId)?.role

  const defaultMailboxes = mailboxItems.value.filter((item) => {
    const role = roleOf(item)
    return role && !SECONDARY_MAILBOX_ROLES.includes(role)
  })
  const starredItem = {
    label: __('Starred'),
    icon: Star,
    to: { name: 'mail-mailbox', params: { accountId: store.accountId, mailbox: 'starred' } },
    activeFor: ['starred'],
  }
  // Synthetic like Starred, but backed by the server's held (FUTURERELEASE)
  // EmailSubmissions rather than a mailbox, so it opens a dedicated page.
  const outboxItem = {
    label: __('Outbox'),
    icon: CalendarClock,
    to: { name: 'mail-outbox', params: { accountId: store.accountId } },
    activeFor: ['mail-outbox', 'mail-submission'],
  }
  const defaultItems = [...defaultMailboxes, starredItem, outboxItem]

  const secondaryItems = mailboxItems.value
    .filter((item) => {
      const role = roleOf(item)
      return role && SECONDARY_MAILBOX_ROLES.includes(role)
    })
    .sort(
      (a, b) =>
        SECONDARY_MAILBOX_ROLES.indexOf(roleOf(a)!) - SECONDARY_MAILBOX_ROLES.indexOf(roleOf(b)!),
    )

  const customMailboxes = mailboxItems.value.filter((item) => !roleOf(item) && !isScreening(item))
  const addMailboxItem = {
    label: __('New Folder'),
    icon: Plus,
    onClick: () => {
      selectedMailbox.value = undefined
      showFolderModal.value = true
    },
  }
  const customItems = [...customMailboxes, addMailboxItem]

  const groups = [
    { label: __('Default'), items: defaultItems },
    { label: __('Custom'), items: customItems },
    ...(secondaryItems.length
      ? [{ label: __('More'), key: 'more', items: secondaryItems, collapsible: true }]
      : []),
  ]

  // The Screener is pinned in a nameless group above the folders, only when screening is enabled.
  const pinnedItems = []
  if (screenerItem && screeningEnabled.value) pinnedItems.push(screenerItem)

  if (pinnedItems.length) groups.unshift({ label: '', items: pinnedItems })

  // Admins reach the dashboard from its own row, last in the sidebar.
  if (
    user.data?.is_jmap_configured &&
    user.data?.is_suite_admin &&
    user.data?.is_suite_cloud_configured &&
    !isMobile.value
  )
    groups.push({
      label: __('Admin'),
      items: [{ label: __('Admin Dashboard'), icon: Crown, to: { path: '/mail/dashboard' } }],
    })

  // The phone's settings page. A desktop opens Settings from the account menu instead.
  if (isMobile.value)
    groups.push({
      label: '',
      items: [
        {
          label: __('Profile'),
          icon: CircleUserRound,
          to: { name: 'mail-profile', params: { accountId: store.accountId } },
          activeFor: ['mail-profile'],
        },
      ],
    })

  return groups
})
</script>
