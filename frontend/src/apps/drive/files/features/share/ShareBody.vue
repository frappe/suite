<template>
  <div class="space-y-5 text-base text-ink-gray-8">
    <div
      v-if="!state.node.value && !state.loadError.value"
      class="space-y-3"
      :aria-label="__('Loading who has access')"
    >
      <Skeleton v-for="index in 4" :key="index" class="h-8 w-full" />
    </div>
    <ErrorMessage v-else-if="state.loadError.value" :message="state.loadError.value" />
    <p v-else-if="!state.canManage.value" class="text-p-sm text-ink-gray-6">
      {{
        __('You can no longer share this item. Only people who can manage it see who has access.')
      }}
    </p>
    <template v-else-if="sections && node">
      <SharePicker
        v-model:picked="picked"
        :node-kind="node.kind"
        :disabled="state.isPending(PICKER)"
        :autofocus="autofocusPicker"
        :share="share"
        @send-link="(email, role) => state.sendLink(email, role)"
      />
      <ErrorMessage v-if="state.errors.get(PICKER)" :message="state.errors.get(PICKER)" />
      <div
        v-if="state.notice.value && state.canUndo.value"
        class="flex items-center gap-3 rounded-4 bg-surface-gray-2 py-1 pl-3 pr-1"
      >
        <p role="status" class="min-w-0 flex-1 py-1 text-p-sm text-ink-gray-7">
          {{ state.notice.value }}
        </p>
        <Button
          variant="ghost"
          :label="__('Undo')"
          :loading="state.isPending(UNDO_ROW)"
          @click="state.undoRemove()"
        />
      </div>
      <p
        v-else-if="state.notice.value"
        role="status"
        class="rounded-4 bg-surface-gray-2 px-3 py-2 text-p-sm text-ink-gray-7"
      >
        {{ state.notice.value }}
      </p>
      <ErrorMessage v-if="state.errors.get(UNDO_ROW)" :message="state.errors.get(UNDO_ROW)" />

      <section v-if="!picked" :aria-label="__('Who has access')">
        <div class="mb-1 flex h-7 items-center justify-between gap-3">
          <h3 class="text-base-medium">{{ __('Who has access') }}</h3>
          <Button
            v-if="sections.links && newLinkButton"
            icon-left="lucide-link"
            :label="__('New link')"
            :loading="state.isPending(NEW_LINK_ROW)"
            @click="createLink"
          />
          <Dropdown
            v-else-if="sections.links"
            :options="[
              {
                label: __('Create share link'),
                icon: 'lucide-link',
                onClick: () => (creatingLink = true),
              },
            ]"
            align="end"
          >
            <Button
              icon="lucide-ellipsis"
              variant="ghost"
              size="sm"
              :aria-label="__('Sharing options')"
            />
          </Dropdown>
        </div>
        <ErrorMessage
          v-if="newLinkButton && state.errors.get(NEW_LINK_ROW)"
          class="mb-2"
          :message="state.errors.get(NEW_LINK_ROW)"
        />
        <ul>
          <li
            v-for="row in rows"
            :key="row.key"
            class="relative before:absolute before:left-11 before:right-0 before:top-0 before:border-t before:border-outline-gray-1 first:before:border-0"
            :class="{ 'opacity-60': isMuted(row) }"
          >
            <div class="flex h-[60px] items-center gap-3">
              <Avatar
                v-if="row.type === 'owner' || (row.type !== 'general' && row.kind === 'user')"
                size="xl"
                :image="personImage(row)"
                :label="rowName(row)"
                class="shrink-0"
              />
              <span
                v-else
                class="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-6"
                aria-hidden="true"
              >
                <span :class="[rowIcon(row), 'size-4']" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-p-base-medium">{{ rowName(row) }}</p>
                <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-ink-gray-5">
                  <span class="truncate">{{ rowDescription(row) }}</span>
                  <span
                    v-if="sourceTitle(row)"
                    class="max-w-[45%] shrink-0 truncate rounded-3 bg-surface-gray-2 px-1.5 py-0.5 text-xs"
                    :title="sourceTitle(row)"
                  >
                    {{ __('via {0}', [sourceTitle(row)]) }}
                  </span>
                </div>
              </div>
              <Switch
                v-if="
                  row.type === 'general' && row.kind === 'public' && showsPublicSwitch(row.access)
                "
                size="sm"
                class="shrink-0"
                :model-value="isOpen(row.access)"
                :aria-label="publicName()"
                :disabled="state.isPending(PUBLIC)"
                @update:model-value="(enabled) => state.setPublic(enabled)"
              />
              <Select
                v-else-if="
                  !oneRoleMenu &&
                  row.type === 'general' &&
                  row.kind === 'general' &&
                  (row.access.state === 'local' || row.access.state === 'off')
                "
                size="sm"
                variant="subtle"
                class="w-28 shrink-0"
                :model-value="row.access.state === 'local' ? row.access.row.grant.role : 0"
                :options="workspaceRoles"
                :aria-label="__('Access for {0}: {1}', [rowName(row), rowValue(row)])"
                :disabled="state.isPending(GENERAL)"
                @update:model-value="
                  (role) => typeof role === 'number' && state.setGeneral(GENERAL, role || null)
                "
              />
              <Dropdown v-else-if="hasMenu(row)" :options="rowOptions(row)" align="end">
                <Button
                  :variant="
                    !oneRoleMenu &&
                    row.type !== 'owner' &&
                    (row.kind === 'link' || row.kind === 'general')
                      ? 'subtle'
                      : 'ghost'
                  "
                  icon-right="lucide-chevron-down"
                  class="shrink-0 justify-end"
                  :aria-label="__('Access for {0}: {1}', [rowName(row), rowValue(row)])"
                  :loading="state.isPending(rowPrincipal(row))"
                >
                  {{ rowValue(row) }}
                </Button>
              </Dropdown>
              <span v-else class="shrink-0 px-2 text-sm text-ink-gray-5">{{ rowValue(row) }}</span>
            </div>
            <form
              v-if="editing?.key === row.key"
              class="flex items-center gap-2 pb-3 pl-11"
              @submit.prevent="save(row)"
            >
              <Password
                v-if="editing.mode === 'password'"
                v-model="password"
                class="min-w-0 flex-1"
                :placeholder="__('New password')"
                :aria-label="__('Link password')"
                autocomplete="new-password"
              />
              <DatePicker
                v-else
                v-model="day"
                class="min-w-0 flex-1"
                :placeholder="__('Expiry date')"
                :aria-label="__('Access expiry date')"
              />
              <Button
                type="submit"
                variant="solid"
                :label="__('Save')"
                :loading="state.isPending(rowPrincipal(row))"
                :disabled="!ready"
              />
              <Button :label="__('Cancel')" @click="closeEditor" />
            </form>
            <ErrorMessage
              v-if="state.errors.get(rowPrincipal(row))"
              class="pb-2 pl-11"
              :message="state.errors.get(rowPrincipal(row))"
            />
          </li>
        </ul>
        <p v-if="addedBy" class="mt-2 flex items-center gap-2 text-p-sm text-ink-gray-5">
          <Avatar size="xs" :image="addedBy.user_image ?? undefined" :label="addedBy.full_name" />
          {{ __('Added by {0}', [addedBy.full_name]) }}
        </p>
      </section>
      <ShareLinkDialog
        v-if="creatingLink"
        v-model:open="creatingLink"
        :state="state"
        :node-kind="node.kind"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  Avatar,
  Button,
  DatePicker,
  Dropdown,
  ErrorMessage,
  Password,
  Select,
  Skeleton,
  Switch,
  type DropdownItem,
  type DropdownOption,
} from 'frappe-ui'
import { computed, ref } from 'vue'

import {
  GENERAL,
  PUBLIC,
  roleLabel,
  rolesFor,
  type PrincipalKind,
} from '@/apps/drive/client/grants'
import { DRIVE_ROLES, type DrivePerson } from '@/apps/drive/client/types'
import { confirm } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'
import { useTweak } from '@/platform/tweaks'

import { copyLink, copyNewLink, formatDay, stampDay } from './shareFormat'
import ShareLinkDialog from './ShareLinkDialog.vue'
import { roleMenu } from './shareMenu'
import {
  isOpen,
  isPublicFromAncestor,
  type GeneralAccess,
  type InheritedRow,
  type LocalRow,
  type PickedPerson,
} from './shareModel'
import SharePicker from './SharePicker.vue'
import { NEW_LINK_ROW, PICKER, UNDO_ROW, type ShareState } from './useShare'

/** One ordered list of principals, with inherited grants in place by reach. */
const props = defineProps<{ state: ShareState; autofocusPicker?: boolean }>()
const picked = defineModel<number>('picked', { default: 0 })
const node = computed(() => props.state.node.value)
const sections = computed(() => props.state.sections.value)
const creatingLink = ref(false)
const accessWords = useTweak('t4-access-words')
const publicRemoves = useTweak('t4-public-off')
const oneRoleMenu = useTweak('t5')
const newLinkButton = useTweak('t9')
const confirmIrreversible = useTweak('t33-confirm-irreversible')
const folderWording = useTweak('t33-public-folder-wording')
const publicFromAncestor = computed(() => !!sections.value && isPublicFromAncestor(sections.value))
// Who put the node here (`node.owner`), when the Owner row does not already
// name them: always in the Shared root, where no one is Owner.
const addedBy = computed(() => {
  const owner = node.value?.owner
  return owner && owner.id !== sections.value?.owner?.id ? owner : null
})
const workspaceRoles = computed(() => [
  { label: __('No access'), value: 0 },
  ...rolesFor('general', node.value?.kind ?? 'document').map((role) => ({
    ...role,
    label: __(role.label),
  })),
])

type UnifiedRow =
  | {
      type: 'general'
      key: string
      kind: 'public' | 'general'
      principal: string
      access: GeneralAccess
    }
  | { type: 'local'; key: string; kind: PrincipalKind; grantRow: LocalRow }
  | { type: 'inherited'; key: string; kind: PrincipalKind; inherited: InheritedRow; source: string }
  | { type: 'owner'; key: string; person: DrivePerson }

const rows = computed<UnifiedRow[]>(() => {
  const current = sections.value
  if (!current) return []
  const result: UnifiedRow[] = []
  if (current.public)
    result.push({
      type: 'general',
      key: PUBLIC,
      kind: 'public',
      principal: PUBLIC,
      access: current.public,
    })
  result.push({
    type: 'general',
    key: GENERAL,
    kind: 'general',
    principal: GENERAL,
    access: current.organization,
  })
  for (const kind of ['link', 'group', 'user'] as const) {
    for (const grantRow of [...(current.links ?? []), ...current.people].filter(
      (entry) => entry.kind === kind,
    )) {
      result.push({ type: 'local', key: `local:${grantRow.grant.principal}`, kind, grantRow })
    }
    for (const part of current.inherited) {
      part.rows.forEach((inherited, index) => {
        if (inherited.kind === kind)
          result.push({
            type: 'inherited',
            key: `inherited:${part.node}:${index}`,
            kind,
            inherited,
            source: part.title,
          })
      })
    }
  }
  if (current.owner) result.push({ type: 'owner', key: 'owner', person: current.owner })
  const rank = (row: UnifiedRow) =>
    row.type === 'owner' ? 0 : { user: 1, group: 2, general: 3, public: 4, link: 5 }[row.kind]
  return result.sort((a, b) => rank(a) - rank(b))
})

const editing = ref<{ key: string; mode: 'expiry' | 'password' } | null>(null)
const day = ref('')
const password = ref('')
const ready = computed(() => (editing.value?.mode === 'password' ? !!password.value : !!day.value))

function rowPrincipal(row: UnifiedRow): string {
  if (row.type === 'general') return row.principal
  if (row.type === 'local') return row.grantRow.grant.principal
  if (row.type === 'inherited') return row.inherited.entry.grant.principal
  return row.person.id
}

function rowName(row: UnifiedRow): string {
  if (row.type === 'owner') return row.person.full_name
  if (row.kind === 'link') return __('Anyone with this link')
  if (row.kind === 'public') return publicName()
  return props.state.label(rowPrincipal(row))
}

function publicName(): string {
  return accessWords.value ? __('Public on the web') : __('Everyone on the web')
}

function personImage(row: UnifiedRow): string | undefined {
  if (row.type === 'owner') return row.person.user_image ?? undefined
  if (row.type === 'local') return row.grantRow.grant.person?.user_image ?? undefined
  if (row.type === 'inherited') return row.inherited.entry.grant.person?.user_image ?? undefined
  return undefined
}

function rowIcon(row: UnifiedRow): string {
  if (row.type === 'owner') return 'lucide-user'
  return {
    public: 'lucide-globe',
    general: 'lucide-building-2',
    link: 'lucide-link',
    group: 'lucide-users',
    user: 'lucide-user',
  }[row.kind]
}

function sourceTitle(row: UnifiedRow): string {
  if (row.type === 'inherited') return row.source
  if (row.type !== 'general') return ''
  if (row.access.state === 'inherited') return row.access.entry.source_title
  if (row.access.state === 'expired') return row.access.entry?.source_title ?? ''
  return ''
}

function rowDescription(row: UnifiedRow): string {
  if (row.type === 'owner')
    return row.person.full_name === row.person.id ? __('Owns this item') : row.person.id
  if (row.type === 'general') {
    // Switching web access off writes a deny, so both read as not published.
    const isOff = row.access.state === 'off' || row.access.state === 'denied'
    if (row.kind === 'public' && row.access.state === 'denied' && publicRemoves.value)
      return __('Public access blocked here')
    if (accessWords.value) return generalDescription(row)
    if (row.kind === 'public' && isOff) return __('Not published on the web')
    if (row.access.state === 'off') return __('Workspace access is turned off')
    if (row.access.state === 'denied') return __('Denied here')
    if (row.access.state === 'expired') return expiredDescription(row.access)
    return row.kind === 'public' ? publicReach() : __('Everyone in this workspace')
  }
  const grant = row.type === 'local' ? row.grantRow.grant : row.inherited.entry.grant
  if (row.type === 'local' && row.grantRow.denied) return __('Denied here')
  if (row.type === 'local' && row.grantRow.expired)
    return __('Expired {0}', [formatDay(grant.expires_on ?? '')])
  if (row.kind === 'user')
    return grant.expires_on
      ? __('{0} · Until {1}', [grant.principal, formatDay(grant.expires_on)])
      : grant.principal
  if (row.kind === 'group')
    return grant.expires_on ? __('Group · Until {0}', [formatDay(grant.expires_on)]) : __('Group')
  const details = [
    grant.expires_on ? __('Until {0}', [formatDay(grant.expires_on)]) : __('No expiry'),
  ]
  if (grant.has_password) details.push(__('Password set'))
  if (grant.sent_to) details.push(__('Sent to {0}', [grant.sent_to]))
  return details.join(' · ')
}

/** The subtitle of the org and public rows with `t4-access-words`: what the access lets people do. */
function generalDescription(row: Extract<UnifiedRow, { type: 'general' }>): string {
  const access = row.access
  if (access.state === 'off') return row.kind === 'public' ? __('Not public') : __('Not shared')
  if (access.state === 'denied') return row.kind === 'public' ? __('Not public') : __('Denied here')
  if (access.state === 'expired') return expiredDescription(access)
  if (row.kind === 'public') return publicReach()
  const role = access.state === 'local' ? access.row.grant.role : access.entry.grant.role
  if (role === DRIVE_ROLES.read) return __('Can view')
  if (role === DRIVE_ROLES.comment) return __('Can comment')
  if (role === DRIVE_ROLES.upload) return __('Can upload')
  if (role === DRIVE_ROLES.edit) return __('Can edit')
  return __(roleLabel(role))
}

/** What public access reaches. Publishing a folder publishes everything in it, with `t33-public-folder-wording`. */
function publicReach(): string {
  return folderWording.value && node.value?.kind === 'folder'
    ? __('Anyone can view everything in it')
    : __('Anyone on the internet can view')
}

function expiredDescription(access: Extract<GeneralAccess, { state: 'expired' }>): string {
  const expired = __('Expired {0}', [formatDay(access.row.grant.expires_on ?? '')])
  if (!access.entry) return expired
  return __('{0} · {1} inherited', [expired, __(roleLabel(access.entry.grant.role))])
}

/**
 * The public row's control is its switch. With `t4-public-off` the switch only
 * publishes here or removes that grant, so an item public through a parent
 * folder, or blocked here, gets a menu instead.
 */
function showsPublicSwitch(access: GeneralAccess): boolean {
  return !publicRemoves.value || (!publicFromAncestor.value && access.state !== 'denied')
}

function rowValue(row: UnifiedRow): string {
  if (row.type === 'owner') return __('Owner')
  if (row.type === 'general') {
    if (row.access.state === 'off') return __('No access')
    if (row.access.state === 'denied') return __('Denied')
    if (row.access.state === 'expired') return __('Expired')
    return row.kind === 'public'
      ? __('On')
      : __(
          roleLabel(
            row.access.state === 'local' ? row.access.row.grant.role : row.access.entry.grant.role,
          ),
        )
  }
  if (row.type === 'inherited') return __(roleLabel(row.inherited.entry.grant.role))
  if (row.grantRow.denied) return __('Denied')
  if (row.grantRow.expired) return __('Expired')
  return __(roleLabel(row.grantRow.grant.role))
}

function isMuted(row: UnifiedRow): boolean {
  return (
    row.type === 'inherited' ||
    (row.type === 'general' &&
      (row.access.state === 'inherited' || row.access.state === 'expired')) ||
    (row.type === 'local' && row.grantRow.expired)
  )
}

function hasMenu(row: UnifiedRow): boolean {
  return (
    row.type === 'general' ||
    row.type === 'local' ||
    (row.type === 'inherited' && row.inherited.deniable)
  )
}

function rowOptions(row: UnifiedRow): DropdownItem[] {
  if (row.type === 'general') return generalOptions(row)
  if (row.type === 'inherited')
    return [
      {
        label: __('Deny access here'),
        icon: 'lucide-ban',
        onClick: () => void props.state.deny(rowPrincipal(row)),
      },
    ]
  if (row.type === 'owner') return []
  return localOptions(row)
}

function generalOptions(row: Extract<UnifiedRow, { type: 'general' }>): DropdownItem[] {
  const access = row.access
  // A parent folder publishes the item: only an explicit deny unpublishes it here (§5.10).
  if (
    row.kind === 'public' &&
    publicRemoves.value &&
    (access.state === 'inherited' || access.state === 'local')
  )
    return [
      {
        label: __('Block public access here'),
        icon: 'lucide-ban',
        onClick: () => void props.state.deny(PUBLIC),
      },
    ]
  if (access.state === 'inherited')
    return [
      {
        label: __('Deny access here'),
        icon: 'lucide-ban',
        onClick: () => void props.state.deny(row.principal),
      },
    ]
  if (access.state === 'denied')
    return [{ label: __('Allow again'), onClick: () => void props.state.allowAgain(access.row) }]
  if (access.state === 'expired')
    return [
      { label: __('Remove'), theme: 'red', onClick: () => void props.state.remove(access.row) },
    ]
  const current = access.state === 'local' ? access.row.grant.role : 0
  if (oneRoleMenu.value) {
    const roles = roleMenu(row.kind, node.value?.kind ?? 'document', current, (role) =>
      props.state.setGeneral(row.principal, role),
    )
    if (!current) return [roles]
    const remove: DropdownOption = {
      label: __('Remove'),
      icon: 'lucide-x',
      theme: 'red',
      onClick: () => void props.state.setGeneral(row.principal, null),
    }
    return [roles, { group: 'Remove', hideLabel: true, options: [remove] }]
  }
  return [
    {
      label: __('No access'),
      selected: current === 0,
      onClick: () => void (current && props.state.setGeneral(row.principal, null)),
    },
    ...rolesFor(row.kind, node.value?.kind ?? 'document').map((role) => ({
      label: row.kind === 'public' ? __('On') : __(role.label),
      selected: role.value === current,
      onClick: () =>
        void (role.value !== current && props.state.setGeneral(row.principal, role.value)),
    })),
  ]
}

function localOptions(row: Extract<UnifiedRow, { type: 'local' }>): DropdownItem[] {
  const grantRow = row.grantRow
  const grant = grantRow.grant
  if (grantRow.denied)
    return [{ label: __('Allow again'), onClick: () => void props.state.allowAgain(grantRow) }]
  if (grantRow.expired)
    return [
      {
        label: row.kind === 'link' ? __('Delete link') : __('Remove'),
        theme: 'red',
        onClick: () => void props.state.remove(grantRow),
      },
    ]
  const expiry = expiryOptions(row)
  const link = row.kind === 'link' ? linkOptions(row) : []
  const removal = removalOptions(row)
  if (oneRoleMenu.value)
    return [
      roleMenu(row.kind, node.value?.kind ?? 'document', grant.role, (role) =>
        props.state.setRole(grantRow, role),
      ),
      { group: 'Expiry', hideLabel: true, options: expiry },
      ...(link.length ? [{ group: 'Link', hideLabel: true, options: link }] : []),
      { group: 'Remove', hideLabel: true, options: removal },
    ]
  return [
    {
      label: __('Role'),
      submenu: rolesFor(row.kind, node.value?.kind ?? 'document').map((role) => ({
        label: __(role.label),
        selected: role.value === grant.role,
        onClick: () =>
          void (role.value !== grant.role && props.state.setRole(grantRow, role.value)),
      })),
    },
    ...expiry,
    ...link,
    ...removal,
  ]
}

function expiryOptions(row: Extract<UnifiedRow, { type: 'local' }>): DropdownOption[] {
  const grant = row.grantRow.grant
  const options: DropdownOption[] = [
    {
      label: grant.expires_on ? __('Change expiry') : __('Set expiry'),
      icon: 'lucide-calendar',
      onClick: () => edit(row, 'expiry'),
    },
  ]
  if (grant.expires_on)
    options.push({
      label: __('Remove expiry'),
      icon: 'lucide-calendar-x',
      onClick: () => void props.state.setExpiry(row.grantRow, null),
    })
  return options
}

/** A link row's own items, before Delete link. */
function linkOptions(row: Extract<UnifiedRow, { type: 'local' }>): DropdownOption[] {
  const grantRow = row.grantRow
  const grant = grantRow.grant
  const options: DropdownOption[] = []
  const url = grant.url
  if (url)
    options.push({
      label: __('Copy link'),
      icon: 'lucide-copy',
      onClick: () => void copyLink(url),
    })
  options.push({
    label: grant.has_password ? __('Change password') : __('Set password'),
    icon: 'lucide-lock',
    onClick: () => edit(row, 'password'),
  })
  if (grant.has_password)
    options.push({
      label: __('Remove password'),
      icon: 'lucide-lock-open',
      onClick: () => void props.state.setPassword(grantRow, null),
    })
  options.push({
    label: __('Get new URL'),
    icon: 'lucide-refresh-cw',
    onClick: () => void rotate(grantRow),
  })
  return options
}

function removalOptions(row: Extract<UnifiedRow, { type: 'local' }>): DropdownOption[] {
  const grantRow = row.grantRow
  if (row.kind === 'link')
    return [
      {
        label: __('Delete link'),
        icon: 'lucide-trash-2',
        theme: 'red',
        onClick: () => void deleteLink(grantRow),
      },
    ]
  const options: DropdownOption[] = [
    {
      label: __('Remove'),
      icon: 'lucide-x',
      theme: 'red',
      onClick: () => void props.state.remove(grantRow),
    },
  ]
  if (node.value?.kind === 'folder' || node.value?.kind === 'root')
    options.push({
      label: __('Remove here and inside'),
      icon: 'lucide-folder-x',
      theme: 'red',
      onClick: () => void removeInside(row),
    })
  return options
}

/**
 * A live link's URL cannot come back, so deleting it asks first, as Get new
 * URL does (§7.4). An expired link deletes at once.
 */
async function deleteLink(row: LocalRow) {
  if (
    confirmIrreversible.value &&
    !(await confirm({
      title: __('Delete this link?'),
      message: __("Anyone using this link loses access. This can't be undone."),
      confirmLabel: __('Delete link'),
      destructive: true,
    }))
  )
    return
  await props.state.remove(row)
}

/** Removing a person from everything inside has no Undo, so it asks first. */
async function removeInside(row: Extract<UnifiedRow, { type: 'local' }>) {
  const name = rowName(row)
  if (
    confirmIrreversible.value &&
    !(await confirm({
      title: __('Remove {0} from everything inside?', [name]),
      message: __(
        "{0} loses access to this folder and to everything inside it that was shared with them. This can't be undone.",
        [name],
      ),
      confirmLabel: __('Remove'),
      destructive: true,
    }))
  )
    return
  await props.state.remove(row.grantRow, true)
}

/** "New link": a View link with no expiry and no password, copied at once (§7.7). */
function createLink() {
  if (props.state.isPending(NEW_LINK_ROW)) return
  void copyNewLink(props.state.newLink())
}

function edit(row: UnifiedRow, mode: 'expiry' | 'password') {
  if (row.type !== 'local') return
  day.value = stampDay(row.grantRow.grant.expires_on)
  password.value = ''
  editing.value = { key: row.key, mode }
}

function closeEditor() {
  password.value = ''
  editing.value = null
}

async function save(row: UnifiedRow) {
  if (row.type !== 'local' || !editing.value) return
  if (editing.value.mode === 'password') {
    const typed = password.value
    password.value = ''
    await props.state.setPassword(row.grantRow, typed)
  } else await props.state.setExpiry(row.grantRow, day.value)
  if (!props.state.errors.get(rowPrincipal(row))) closeEditor()
}

async function rotate(row: LocalRow) {
  if (
    !(await confirm({
      title: __('Get a new URL?'),
      message: __('The old URL stops working.'),
      confirmLabel: __('Get new URL'),
    }))
  )
    return
  const url = await props.state.rotate(row)
  if (url) await copyLink(url, __('New link copied'))
}

async function share(
  people: PickedPerson[],
  role: number,
  notify: boolean,
): Promise<PickedPerson[]> {
  for (const person of people) props.state.rememberName(person.principal, person.name)
  const left = new Set(
    await props.state.add(
      people.map((person) => person.principal),
      role,
      notify,
    ),
  )
  return people.filter((person) => left.has(person.principal))
}
</script>
