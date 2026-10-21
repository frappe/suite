<template>
  <!-- Mail's own sidebar, in the shell's sidebar slot on a desktop and in the
	     bottom nav's sheet on a phone. The page header's folder button and a tap
	     on the active Mail tab open the sheet. -->
  <!-- On a phone it is the folders sheet, as develop's was: each folder with its count and nothing
       else (editing a folder is Settings' there), no title, and one height, so More opens in it. -->
  <AreaSidebar area="mail" :title="__('Mail')" :sheet-title="false" steady-sheet>
    <!-- The active account leads. Its menu lists the accounts, and every account at once. With
         one account, or on the dashboard, there is nothing to pick: it is just named. A phone
         switches accounts on the Profile page instead, so its folders sheet is folders only. -->
    <SidebarSection v-if="!isMobile" class="!mt-0">
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
    <!-- A section's own action (the folders' "+") sits over the right end of its heading:
	     SidebarSection draws the heading itself and leaves no place in it for one. -->
    <div v-for="section in sidebarItems" :key="section.key ?? section.label" class="relative mt-4">
      <!-- Small and muted, lined up with the folders' counts below it. -->
      <Tooltip v-if="sectionAction(section)" :text="sectionAction(section)!.label">
        <button
          type="button"
          class="text-ink-gray-5 hover:text-ink-gray-8 absolute right-2 top-1.5 z-10 flex size-4 items-center justify-center"
          :aria-label="sectionAction(section)!.label"
          @click="sectionAction(section)!.onClick()"
        >
          <span class="lucide-plus size-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
      <SidebarSection
        :label="section.label"
        :collapsible="section.collapsible"
        :collapsed="isSectionCollapsed(section)"
        class="!mt-0"
        @update:collapsed="(collapsed) => setSectionCollapsed(section.key, collapsed)"
      >
        <SidebarItem
          v-for="item in section.items"
          :key="item.label"
          :label="item.label"
          :icon="item.icon"
          :route="item.to"
          :class="
            threadDrag.overMailbox.value === item.mailboxId &&
            'ring-2 ring-outline-gray-3 ring-inset'
          "
          :active="item.activeFor?.includes(activeKey)"
          :on-click="item.onClick"
          class="group has-[>:is(a,button):focus-visible]:focus-ring [&>:is(a,button):focus-visible]:!outline-none"
          @dragover="onFolderDragOver($event, item)"
          @dragleave="onFolderDragLeave(item)"
          @drop="onFolderDrop($event, item)"
        >
          <template #suffix>
            <!-- More says which way it opens with its own icon (see moreToggle), so it has no
                 suffix. -->
            <div v-if="!isMoreToggle(item)" class="flex items-center">
              <!-- The menu shows on hover, on a touch screen (no hover to show it), and when Tab
                   reaches it: hidden then, its focus ring ringed nothing. -->
              <Dropdown v-if="item.menuOptions && !isMobile" :options="item.menuOptions">
                <Button variant="ghost" class="!bg-transparent" @click.stop>
                  <template #icon>
                    <Ellipsis
                      class="text-ink-gray-6 invisible h-4 w-4 group-hover:visible group-has-[button:focus-visible]:visible [@media(hover:none)]:visible"
                    />
                  </template>
                </Button>
              </Dropdown>
              <span
                class="text-ink-gray-4 mr-2 text-sm"
                :class="{
                  'group-hover:hidden group-has-[button:focus-visible]:hidden':
                    item.menuOptions && !isMobile,
                }"
              >
                {{ item.suffix }}
              </span>
            </div>
          </template>
        </SidebarItem>
      </SidebarSection>
    </div>

    <!-- Personal widgets (quota) are meaningless while administering the
		     server, and the phone's sheet is a folder switcher, not a dashboard. -->
    <AreaSidebarFooter v-if="showWidgets">
      <QuotaBar :is-collapsed="false" />
    </AreaSidebarFooter>
  </AreaSidebar>

  <FolderModal v-model="showFolderModal" :mailbox="selectedMailbox" />
  <DeleteFolderModal v-model="showDeleteMailbox" :mailbox="selectedMailbox" />
</template>

<script setup lang="ts">
import { useIntervalFn, useStorage } from '@vueuse/core'
import ArrowLeft from '~icons/lucide/arrow-left'
import CalendarClock from '~icons/lucide/calendar-clock'
import ChevronDown from '~icons/lucide/chevron-down'
import ChevronUp from '~icons/lucide/chevron-up'
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
import { Button, Dropdown, SidebarItem, SidebarSection, Tooltip } from 'frappe-ui'
import { Icon } from 'frappe-ui/experimental'
import { computed, h, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, useQuery } from '@/api'
import DeleteFolderModal from '@/apps/mail/components/Modals/DeleteFolderModal.vue'
import FolderModal from '@/apps/mail/components/Modals/FolderModal.vue'
import QuotaBar from '@/apps/mail/components/QuotaBar.vue'
import { useThreadDrag } from '@/apps/mail/composables/useThreadDrag'
import { FOLDER_ICON_COLOR_MAP } from '@/apps/mail/constants'
import { SECONDARY_MAILBOX_ROLES, userStore, withStarred } from '@/apps/mail/stores/user'
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
import { accountSubmenu, AreaSidebar, AreaSidebarFooter } from '@/platform/area-sidebar'

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

// Junk and Trash, and Outbox while it holds only history, wait behind a More row at the foot of the
// lead folders: a row like theirs that opens in place, rather than a section heading of its own.
const moreOpen = computed(() => !collapsedSections.value.more)
// It opens in place, so its icon is the chevron saying which way: down to open, up to fold away.
const moreToggle = (holds: string[]) => ({
  label: __('More'),
  icon: moreOpen.value ? ChevronUp : ChevronDown,
  to: undefined,
  onClick: () => setSectionCollapsed('more', moreOpen.value),
  activeFor: [] as string[],
  moreToggle: true,
  // What the folders behind it answer to, so the one open can be found there while they are hidden.
  holds,
})
const isMoreToggle = (item: object) => 'moreToggle' in item
const withMore = <T, M extends { activeFor?: string[] }>(items: T[], more: M[]) =>
  more.length
    ? [
        ...items,
        moreToggle(more.flatMap((item) => item.activeFor ?? [])),
        ...(moreOpen.value ? more : []),
      ]
    : items
const store = userStore()
const { mailboxes, unifiedFolders } = store

// "All accounts": the folder list is every account's, merged (see utils/unifiedFolders).
const isUnified = computed(() => isUnifiedRoute(route.name))
// How many sends are waiting to go, which decides where Outbox sits (see sidebarItems). One row is
// enough to be told the total.
const queuedSends = useQuery(api.mail.scheduled.list, () =>
  store.accountId && !isUnified.value
    ? { account: store.accountId, undo_status: 'pending', start: 0, page_length: 1 }
    : false,
)
// A scheduled send goes out on its own, and nothing on this page hears it go: while anything is
// waiting, the count is asked again every 30 seconds (as the Outbox's own list is), so a sent
// mail stops being counted and Outbox goes back under More. Nothing waiting, nothing asked.
const recheckQueued = useIntervalFn(() => void queuedSends.refetch().catch(() => {}), 30_000, {
  immediate: false,
})
watch(
  () => queuedSends.data?.total ?? 0,
  (queued) => (queued ? recheckQueued.resume() : recheckQueued.pause()),
  { immediate: true },
)

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

// A thread dragged onto More and held there opens it, so it can go on into Junk, Archive or Trash.
// Held, not passed over: on the way to a folder below, More opening would push the folder down
// under the pointer. Opened this way, it closes again once the drag is over.
const SPRING_OPEN_MS = 500
let springTimer: ReturnType<typeof setTimeout> | undefined
const springOpened = ref(false)
const cancelSpring = () => {
  clearTimeout(springTimer)
  springTimer = undefined
}
watch(threadDrag.isDragging, (dragging) => {
  if (dragging) return
  cancelSpring()
  if (springOpened.value) setSectionCollapsed('more', true)
  springOpened.value = false
})

const onFolderDragOver = (e: DragEvent, item: { mailboxId?: string }) => {
  if (isMoreToggle(item)) {
    if (!threadDrag.isDragging.value || moreOpen.value || springTimer) return
    springTimer = setTimeout(() => {
      springTimer = undefined
      springOpened.value = true
      setSectionCollapsed('more', false)
    }, SPRING_OPEN_MS)
    return
  }
  if (!canDrop(item)) return
  // Without preventDefault the browser refuses the drop and shows the "no" cursor.
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  threadDrag.overMailbox.value = item.mailboxId!
}

const onFolderDragLeave = (item: { mailboxId?: string }) => {
  if (isMoreToggle(item)) cancelSpring()
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

// What's unread, where that means something: the mail you sent is yours, and "unread" there is
// only a flag left over from somewhere else.
const unreadSuffix = (role: string | null | undefined, unread?: number | null) =>
  role !== 'sent' && unread ? String(unread) : ''

const mailboxItems = computed(
  () =>
    mailboxes.data
      ?.filter((mailbox: MailboxData) => mailbox.subscribed)
      ?.map((mailbox: MailboxData) => {
        return {
          mailboxId: mailbox.id,
          label: getMailboxName(mailbox),
          icon: h(Icon, {
            name: getIcon(mailbox),
            class: mailbox.color ? FOLDER_ICON_COLOR_MAP[mailbox.color] : undefined,
          }),
          to: {
            name: 'mail-mailbox',
            params: {
              accountId: store.accountId,
              mailbox: mailboxParam(mailbox.id, mailboxes.data),
            },
          },
          role: mailbox.role,
          suffix: unreadSuffix(mailbox.role, mailbox.unread_threads),
          activeFor: [mailbox.id],
          menuOptions: [
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

// The folder list of "All accounts", grouped as an account's is: system folders and Starred, then the
// custom folders, then Junk/Archive/Trash under More. Nothing account-bound — Outbox, New Folder —
// has a merged form, so none of it is offered here.
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
    role: folder.role,
    suffix: unreadSuffix(folder.role, folder.unread_threads),
  })
  const starredItem = {
    label: __('Starred'),
    icon: Star,
    to: unifiedFolderRoute(STARRED_FOLDER),
    activeFor: [`unified:${STARRED_FOLDER}`],
  }
  const { primary, custom, secondary } = groupUnifiedFolders(folders)

  return [
    {
      label: '',
      key: 'lead',
      items: withMore(
        withStarred(primary.map(toItem), (item) => item.role, { ...starredItem, role: null }),
        secondary.map(toItem),
      ),
    },
    ...(custom.length
      ? [{ label: __('Your folders'), key: 'folders', items: custom.map(toItem) }]
      : []),
  ]
})

// The one thing a section's heading offers to do, if anything (only the folders' "New Folder").
type SectionAction = { label: string; onClick: () => void }
const sectionAction = (section: object): SectionAction | undefined =>
  'action' in section ? (section.action as SectionAction) : undefined

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

  const leadMailboxes = mailboxItems.value.filter(
    (item) => item.role && !SECONDARY_MAILBOX_ROLES.includes(item.role),
  )
  const starredItem = {
    label: __('Starred'),
    icon: Star,
    to: { name: 'mail-mailbox', params: { accountId: store.accountId, mailbox: 'starred' } },
    activeFor: ['starred'],
    role: null,
  }
  // Synthetic like Starred, but backed by the server's held (FUTURERELEASE)
  // EmailSubmissions rather than a mailbox, so it opens a dedicated page. It leads, with its count,
  // only while something is waiting to go; otherwise it is history, and waits under More.
  const queued = queuedSends.data?.total ?? 0
  const outboxItem = {
    label: __('Outbox'),
    icon: CalendarClock,
    to: { name: 'mail-outbox', params: { accountId: store.accountId } },
    activeFor: ['mail-outbox', 'mail-submission'],
    suffix: queued ? String(queued) : '',
  }
  const leadItems = [
    ...withStarred(leadMailboxes, (item) => item.role, starredItem),
    ...(queued ? [outboxItem] : []),
  ]

  const secondaryItems: ((typeof mailboxItems.value)[number] | typeof outboxItem)[] =
    mailboxItems.value
      .filter((item) => item.role && SECONDARY_MAILBOX_ROLES.includes(item.role))
      .sort(
        (a, b) =>
          SECONDARY_MAILBOX_ROLES.indexOf(a.role!) - SECONDARY_MAILBOX_ROLES.indexOf(b.role!),
      )
  // Outbox's history is your own mail, so it follows Archive, ahead of Junk and Trash.
  if (!queued)
    secondaryItems.splice(
      secondaryItems.findIndex((item) => 'role' in item && item.role === 'archive') + 1,
      0,
      outboxItem,
    )

  const yourFolders = mailboxItems.value.filter((item) => !item.role)
  const newFolder = () => {
    selectedMailbox.value = undefined
    showFolderModal.value = true
  }
  const groups = [
    { label: '', key: 'lead', items: withMore(leadItems, secondaryItems) },
    // With folders of your own, the heading carries the "+". With none, a heading over nothing read
    // as a list that had failed to load: a New Folder row sits under it instead, and the heading's
    // "+" would only repeat it.
    {
      label: __('Your folders'),
      key: 'folders',
      items: yourFolders.length
        ? yourFolders
        : [{ label: __('New Folder'), icon: Plus, to: undefined, onClick: newFolder }],
      ...(yourFolders.length ? { action: { label: __('New Folder'), onClick: newFolder } } : {}),
    },
  ]

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

  return groups
})

// A folder behind More that is open — reached by a link, a shortcut or a search — opens More, so
// the sidebar shows where you are rather than a highlight hidden under a folded row.
watch(
  () =>
    sidebarItems.value
      .flatMap((group) => group.items as object[])
      .some((item) => 'holds' in item && (item.holds as unknown[]).includes(activeKey.value)),
  (inside) => inside && setSectionCollapsed('more', false),
  { immediate: true },
)
</script>
