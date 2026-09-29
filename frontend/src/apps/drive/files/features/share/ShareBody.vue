<template>
  <div class="space-y-5 text-base text-ink-gray-8">
    <div v-if="!state.node.value && !state.loadError.value" class="space-y-3" aria-label="Loading who has access">
      <Skeleton v-for="index in 4" :key="index" class="h-8 w-full" />
    </div>

    <ErrorMessage v-else-if="state.loadError.value" :message="state.loadError.value" />

    <p v-else-if="!state.canManage.value" class="text-p-sm text-ink-gray-6">
      You can no longer share this item. Only people who can manage it see who has access.
    </p>

    <template v-else-if="sections && node">
      <div>
        <SharePicker
          :node-kind="node.kind"
          :disabled="state.pending.value === PICKER"
          @add="add"
          @send-link="(email, role) => state.sendLink(email, role)"
        />
        <ErrorMessage v-if="state.errors.get(PICKER)" class="mt-2" :message="state.errors.get(PICKER)" />
      </div>

      <p v-if="state.notice.value" role="status" class="rounded-4 bg-surface-gray-2 px-3 py-2 text-p-sm text-ink-gray-7">
        {{ state.notice.value }}
      </p>

      <section aria-labelledby="share-people">
        <h3 id="share-people" class="mb-1 text-sm text-ink-gray-5">People</h3>
        <p v-if="!sections.people.length" class="py-2 text-p-sm text-ink-gray-5">No one is added here yet.</p>
        <ul>
          <li v-for="row in sections.people" :key="row.grant.principal">
            <div class="flex min-h-12 items-center gap-3" :class="{ 'opacity-60': row.expired }">
              <span
                class="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-6"
                aria-hidden="true"
              >
                <span :class="[row.kind === 'group' ? 'lucide-users' : 'lucide-user', 'size-4']" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate">{{ state.label(row.grant.principal) }}</p>
                <p v-if="peopleMeta(row)" class="mt-1 truncate text-sm text-ink-gray-5">{{ peopleMeta(row) }}</p>
              </div>
              <Button
                v-if="row.denied"
                label="Allow again"
                :loading="state.pending.value === row.grant.principal"
                @click="state.allowAgain(row)"
              />
              <Dropdown v-else :options="personOptions(row)" align="end">
                <Button
                  :label="row.expired ? 'Expired' : roleLabel(row.grant.role)"
                  icon-right="lucide-chevron-down"
                  variant="ghost"
                  :loading="state.pending.value === row.grant.principal"
                />
              </Dropdown>
            </div>
            <ErrorMessage v-if="state.errors.get(row.grant.principal)" class="pb-2" :message="state.errors.get(row.grant.principal)" />
          </li>
        </ul>
      </section>

      <section aria-labelledby="share-general">
        <h3 id="share-general" class="mb-1 text-sm text-ink-gray-5">General access</h3>
        <ul>
          <li v-for="general in generalRows" :key="general.principal">
            <div class="flex min-h-12 items-center gap-3">
              <span
                class="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-6"
                aria-hidden="true"
              >
                <span :class="[general.icon, 'size-4']" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate">{{ general.label }}</p>
                <p v-if="generalMeta(general)" class="mt-1 truncate text-sm text-ink-gray-5">{{ generalMeta(general) }}</p>
              </div>
              <Button
                v-if="general.access.state === 'denied'"
                label="Allow again"
                :loading="state.pending.value === general.principal"
                @click="state.allowAgain(general.access.row)"
              />
              <Dropdown v-else :options="generalOptions(general)" align="end">
                <Button
                  :label="generalValue(general)"
                  icon-right="lucide-chevron-down"
                  variant="ghost"
                  :loading="state.pending.value === general.principal"
                />
              </Dropdown>
            </div>
            <ErrorMessage v-if="state.errors.get(general.principal)" class="pb-2" :message="state.errors.get(general.principal)" />
          </li>
        </ul>
      </section>

      <section v-if="sections.links" aria-labelledby="share-links">
        <div class="mb-1 flex items-center justify-between gap-2">
          <h3 id="share-links" class="text-sm text-ink-gray-5">Share links</h3>
          <Button
            label="New link"
            icon-left="lucide-plus"
            variant="ghost"
            :loading="state.pending.value === NEW_LINK_ROW"
            @click="newLink"
          />
        </div>
        <ErrorMessage v-if="state.errors.get(NEW_LINK_ROW)" class="pb-2" :message="state.errors.get(NEW_LINK_ROW)" />
        <p v-if="!sections.links.length" class="py-2 text-p-sm text-ink-gray-5">No links yet.</p>
        <ul>
          <ShareLinkRow v-for="row in sections.links" :key="row.grant.principal" :row="row" :state="state" :node-kind="node.kind" />
        </ul>
      </section>

      <section v-for="part in sections.inherited" :key="part.node" :aria-label="`From ${part.title}`">
        <button
          type="button"
          class="flex h-8 w-full items-center gap-1.5 rounded-4 text-left text-sm text-ink-gray-5 hover:text-ink-gray-7"
          :aria-expanded="unfolded.has(part.node)"
          @click="toggle(part.node)"
        >
          <span
            :class="[unfolded.has(part.node) ? 'lucide-chevron-down' : 'lucide-chevron-right', 'size-4']"
            aria-hidden="true"
          />
          <span class="truncate">From "{{ part.title }}"</span>
          <span class="shrink-0 text-ink-gray-4">· {{ part.rows.length }}</span>
        </button>
        <ul v-if="unfolded.has(part.node)">
          <li v-for="(inherited, index) in part.rows" :key="`${inherited.entry.grant.principal}-${index}`">
            <div class="flex min-h-12 items-center gap-3">
              <span
                class="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-gray-2 text-ink-gray-6"
                aria-hidden="true"
              >
                <span :class="[kindIcon(inherited.kind), 'size-4']" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate">{{ inheritedLabel(inherited) }}</p>
                <p class="mt-1 truncate text-sm text-ink-gray-5">{{ inheritedMeta(inherited) }}</p>
              </div>
              <Button
                v-if="inherited.deniable"
                label="Deny access here"
                variant="ghost"
                :loading="state.pending.value === inherited.entry.grant.principal"
                @click="state.deny(inherited.entry.grant.principal)"
              />
            </div>
            <ErrorMessage
              v-if="state.errors.get(inherited.entry.grant.principal)"
              class="pb-2"
              :message="state.errors.get(inherited.entry.grant.principal)"
            />
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import { Button, Dropdown, ErrorMessage, Skeleton, type DropdownItem, type DropdownOption } from 'frappe-ui'

import { GENERAL, PUBLIC, roleLabel, rolesFor, type PrincipalKind } from '@/apps/drive/client/grants'
import { confirm } from '@/platform/feedback'
import { useSession } from '@/platform/session'

import ShareLinkRow from './ShareLinkRow.vue'
import SharePicker from './SharePicker.vue'
import { losesOwnManage, type GeneralAccess, type InheritedRow, type LocalRow } from './shareModel'
import { copyLink, formatDay } from './shareFormat'
import { NEW_LINK_ROW, PICKER, type ShareState } from './useShare'

const props = defineProps<{ state: ShareState }>()

const session = useSession()
const node = computed(() => props.state.node.value)
const sections = computed(() => props.state.sections.value)
const unfolded = reactive(new Set<string>())

interface GeneralRow {
  principal: string
  label: string
  icon: string
  kind: PrincipalKind
  access: GeneralAccess
}

const generalRows = computed<GeneralRow[]>(() => {
  const current = sections.value
  if (!current) return []
  const rows: GeneralRow[] = [
    { principal: GENERAL, label: 'Everyone at the org', icon: 'lucide-building-2', kind: 'general', access: current.organization },
  ]
  if (current.public) rows.push({ principal: PUBLIC, label: 'Public on the web', icon: 'lucide-globe', kind: 'public', access: current.public })
  return rows
})

function toggle(part: string) {
  if (unfolded.has(part)) unfolded.delete(part)
  else unfolded.add(part)
}

function kindIcon(kind: PrincipalKind): string {
  return { user: 'lucide-user', group: 'lucide-users', general: 'lucide-building-2', public: 'lucide-globe', link: 'lucide-link' }[kind]
}

function peopleMeta(row: LocalRow): string {
  if (row.expired && row.grant.expires_on) return `Expired ${formatDay(row.grant.expires_on)}`
  if (row.denied) return 'Denied here'
  if (row.grant.expires_on) return `Until ${formatDay(row.grant.expires_on)}`
  return row.kind === 'group' ? 'Group' : ''
}

async function mayLoseManage(row: LocalRow, next: number | null): Promise<boolean> {
  if (!losesOwnManage(row, session.user.value?.id, next)) return true
  return confirm({
    title: 'Change your own access?',
    message: 'You will no longer be able to share this item.',
    confirmLabel: next === null ? 'Remove' : 'Change',
    destructive: true,
  })
}

async function setRole(row: LocalRow, role: number) {
  if (role === row.grant.role) return
  if (await mayLoseManage(row, role)) await props.state.setRole(row, role)
}

async function remove(row: LocalRow, below = false) {
  if (await mayLoseManage(row, null)) await props.state.remove(row, below)
}

function personOptions(row: LocalRow): DropdownItem[] {
  const holdsItems = node.value?.kind === 'folder' || node.value?.kind === 'root'
  const removal: DropdownOption[] = [
    { label: 'Remove', icon: 'lucide-x', theme: 'red', onClick: () => void remove(row) },
    ...(holdsItems
      ? [{ label: 'Remove here and inside', icon: 'lucide-folder-x', theme: 'red' as const, onClick: () => void remove(row, true) }]
      : []),
  ]
  if (row.expired) return removal
  return [
    {
      group: 'Access',
      hideLabel: true,
      options: rolesFor(row.kind, node.value?.kind ?? 'document').map((role) => ({
        label: role.label,
        selected: role.value === row.grant.role,
        onClick: () => void setRole(row, role.value),
      })),
    },
    { group: 'Remove', hideLabel: true, options: removal },
  ]
}

function generalValue(general: GeneralRow): string {
  const access = general.access
  if (access.state === 'off') return 'Off'
  const role = access.state === 'local' ? access.row.grant.role : access.state === 'inherited' ? access.entry.grant.role : 0
  return general.kind === 'public' ? 'On' : roleLabel(role)
}

function generalMeta(general: GeneralRow): string {
  const access = general.access
  if (access.state === 'denied') return 'Denied here'
  if (access.state === 'inherited') {
    const value = general.kind === 'public' ? 'On' : roleLabel(access.entry.grant.role)
    return `${value} · from "${access.entry.source_title}"`
  }
  if (access.state === 'off') return general.kind === 'public' ? 'Only people with access can open it' : 'Only people added can open it'
  return general.kind === 'public' ? 'Anyone on the internet can view' : `Everyone at the org can ${roleLabel(access.row.grant.role).toLowerCase()}`
}

function generalOptions(general: GeneralRow): DropdownItem[] {
  const access = general.access
  if (access.state === 'inherited') {
    return [{ label: 'Deny access here', icon: 'lucide-ban', onClick: () => void props.state.deny(general.principal) }]
  }
  const current = access.state === 'local' ? access.row.grant.role : 0
  const roles = rolesFor(general.kind, node.value?.kind ?? 'document').map((role) => ({
    label: general.kind === 'public' ? 'On' : role.label,
    selected: role.value === current,
    onClick: () => void (role.value !== current && props.state.setGeneral(general.principal, role.value)),
  }))
  return [
    {
      label: 'Off',
      selected: current === 0,
      onClick: () => void (current !== 0 && props.state.setGeneral(general.principal, null)),
    },
    ...roles,
  ]
}

function inheritedLabel(inherited: InheritedRow): string {
  return inherited.kind === 'link' ? 'Share link' : props.state.label(inherited.entry.grant.principal)
}

function inheritedMeta(inherited: InheritedRow): string {
  const grant = inherited.entry.grant
  const parts = [grant.role > 0 ? roleLabel(grant.role) : 'Denied']
  if (grant.has_password) parts.push('Password')
  if (grant.expires_on) parts.push(`Until ${formatDay(grant.expires_on)}`)
  return parts.join(' · ')
}

async function add(principal: string, role: number, notify: boolean, name: string | null) {
  props.state.rememberName(principal, name)
  await props.state.add(principal, role, notify)
}

async function newLink() {
  const url = await props.state.newLink()
  if (url) await copyLink(url)
}
</script>
