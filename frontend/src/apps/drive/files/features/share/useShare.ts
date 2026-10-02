import { computed, reactive, readonly, ref, shallowRef } from 'vue'

import {
  NEW_LINK,
  endOfDayStamp,
  isExpired,
  nodeGrants,
  principalKind,
  type DriveGrant,
  type GrantList,
  type GrantWrite,
} from '@/apps/drive/client/grants'
import { announceAccessChange } from '@/apps/drive/client/accessChanges'
import { api } from '@/apps/drive/client/generated'
import { driveOperation } from '@/apps/drive/client/operation'
import { DRIVE_ROLES, type DriveNode } from '@/apps/drive/client/types'
import { transport as defaultTransport, type Transport } from '@/platform/transport'

import {
  organizationLabel,
  principalLabel,
  remainingAccess,
  roleAfter,
  shareSections,
  type GrantChange,
  type LocalRow,
} from './shareModel'

const nodeGet = driveOperation<{ node: string; expand: string }, DriveNode>(api.node_get, { entity: true })

/** A row key: the principal, or a section key for the picker and + New link. */
export type RowKey = string
export const PICKER: RowKey = 'picker'
export const NEW_LINK_ROW: RowKey = 'new-link'

export interface ShareOptions {
  transport?: Transport
  /** The caller's user id: writes that would lower their own access ask first. */
  me?: string
  /** Asks the caller to confirm losing their own access. Resolves true to go on. */
  confirmLoss?: () => Promise<boolean>
  /** The workspace name, which names everyone at the org. Empty when unknown. */
  workspace?: string
  /** The name an ancestor shows under, such as "My files" for the caller's own root. Defaults to its title. */
  placeTitle?: (node: { name: string; title: string }) => string
}

/**
 * The share dialog's state for one node. Every write reads the grants and the
 * caller's access again, and tells open sessions of the node (unified spec
 * §7.9). A failed write keeps its message on its own row. Rows write
 * independently: each has its own pending flag, and only the newest read
 * lands.
 */
export function useShare(nodeId: string, options: ShareOptions = {}) {
  const transport = options.transport ?? defaultTransport
  const placeTitle = options.placeTitle ?? ((node: { title: string }) => node.title)
  const grants = nodeGrants(nodeId, transport)
  const node = shallowRef<DriveNode | null>(null)
  const list = shallowRef<GrantList | null>(null)
  const loadError = ref('')
  const errors = reactive(new Map<RowKey, string>())
  const pending = reactive(new Set<RowKey>())
  const notice = ref('')
  /** A write went through since the dialog opened. */
  const changed = ref(false)
  /** Names the picker has seen, by email. The grant rows carry emails only. */
  const names = reactive(new Map<string, string>())

  const canManage = computed(() => managesNode(node.value))
  // Ancestors show under their place name, which can change once the caller's roots load.
  const named = computed<GrantList | null>(
    () =>
      list.value && {
        ...list.value,
        inherited: list.value.inherited.map((entry) => ({
          ...entry,
          source_title: placeTitle({ name: entry.source_node, title: entry.source_title }),
        })),
      },
  )
  const sections = computed(() => (named.value && node.value ? shareSections(named.value, node.value.kind) : null))
  const titles = computed(
    () => new Map((named.value?.inherited ?? []).map((entry) => [entry.source_node, entry.source_title])),
  )

  let reads = 0
  async function load() {
    const read = ++reads
    try {
      const fresh = await transport.request(nodeGet, { node: nodeId, expand: 'access' })
      // Reading grants needs MANAGE (spec §7.2). A caller who gave it away sees why.
      const freshList = managesNode(fresh) ? await grants.list() : null
      if (read !== reads) return
      node.value = fresh
      list.value = freshList
      if (freshList?.owner) names.set(freshList.owner.user, freshList.owner.full_name)
      loadError.value = ''
    } catch (error) {
      if (read === reads) loadError.value = messageOf(error, 'Could not load who has access.')
    }
  }

  async function write<T>(key: RowKey, run: () => Promise<T>): Promise<T | undefined> {
    pending.add(key)
    errors.delete(key)
    notice.value = ''
    try {
      const answer = await run()
      changed.value = true
      return answer
    } catch (error) {
      errors.set(key, messageOf(error, 'Could not save this change.'))
      return undefined
    } finally {
      await load()
      announceAccessChange(nodeId)
      pending.delete(key)
    }
  }

  /**
   * Whether a write may go ahead. A change that would lower the caller's own
   * role asks first (§7.4), whatever row carries it: their own row, a group
   * they are in, or everyone at the org.
   */
  async function mayChange(change: GrantChange): Promise<boolean> {
    const { me, confirmLoss } = options
    if (!me || !confirmLoss) return true
    const kind = principalKind(change.principal)
    if (kind === 'link' || kind === 'public' || (kind === 'user' && change.principal !== me)) return true
    const explanation = await grants.explain(me).catch(() => null)
    if (!explanation || roleAfter(explanation, nodeId, change, me) >= explanation.role) return true
    return confirmLoss()
  }

  async function change<T>(key: RowKey, next: GrantChange, run: () => Promise<T>): Promise<T | undefined> {
    pending.add(key)
    if (await mayChange(next)) return write(key, run)
    pending.delete(key)
    return undefined
  }

  const label = (principal: string) => principalLabel(principal, names, options.workspace)

  /**
   * Keeps a live row's expiry: a grant write replaces it (Drive spec §5.9).
   * Writing over an expired row starts it afresh.
   */
  const keep = (grant: DriveGrant | undefined): Pick<GrantWrite, 'expires_on'> =>
    grant ? { expires_on: isExpired(grant) ? null : grant.expires_on } : {}
  const localGrant = (principal: string) => list.value?.grants.find((grant) => grant.principal === principal)

  return {
    node,
    sections,
    loadError,
    errors,
    notice,
    changed: readonly(changed),
    canManage,
    load,
    label,
    organization: organizationLabel(options.workspace),
    isPending: (key: RowKey) => pending.has(key),
    rememberName(email: string, name: string | null) {
      if (name) names.set(email, name)
    },

    setRole: (row: LocalRow, role: number) =>
      change(row.grant.principal, { principal: row.grant.principal, role }, () =>
        grants.put(row.grant.principal, { role, ...keep(row.grant) }),
      ),

    /** Removes the local row. Then says whether access remains, and why (§7.4). */
    async remove(row: LocalRow, below = false) {
      const principal = row.grant.principal
      const removed = await change(principal, { principal, role: null }, async () => ({
        count: await grants.remove(principal, below),
      }))
      if (!removed) return
      // The count includes the row here, which this Remove started from.
      const inside = below && removed.count ? removed.count - 1 : 0
      const insideText = inside ? `Removed from ${inside} ${inside === 1 ? 'item' : 'items'} inside. ` : ''
      let remaining: string | null = null
      if (row.kind !== 'link' && canManage.value && !row.denied) {
        const explanation = await grants.explain(principal).catch(() => null)
        remaining = explanation && remainingAccess(label(principal), principal, explanation, titles.value, label)
      }
      notice.value = `${insideText}${remaining ?? ''}`.trim()
    },

    deny: (principal: string) =>
      change(principal, { principal, role: 0 }, () => grants.put(principal, { role: 0 })),
    allowAgain: (row: LocalRow) => write(row.grant.principal, () => grants.remove(row.grant.principal)),

    /** Everyone at the org or Public on the web. `null` removes the local row. Keeps the expiry. */
    setGeneral: (principal: string, role: number | null) =>
      change(principal, { principal, role }, async () => {
        if (role === null) await grants.remove(principal)
        else await grants.put(principal, { role, ...keep(localGrant(principal)) })
      }),

    /** Adds a user or a group from the picker (§7.8). An existing row keeps its expiry. */
    add: (principal: string, role: number, notify: boolean) =>
      change(PICKER, { principal, role }, () =>
        grants.put(principal, {
          role,
          ...keep(localGrant(principal)),
          ...(principalKind(principal) === 'user' ? { notify } : {}),
        }),
      ),

    /** Mints a link for one outsider and emails it (§7.8). */
    sendLink: (email: string, role: number) =>
      write(PICKER, () => grants.put(NEW_LINK, { role, send_to: email })),

    /** A View link with no expiry and no password (§7.7). Resolves with its URL. */
    async newLink(): Promise<string | undefined> {
      const written = await write(NEW_LINK_ROW, () => grants.put(NEW_LINK, { role: DRIVE_ROLES.read }))
      return written?.url ?? written?.grant.url
    },

    setPassword: (row: LocalRow, password: string | null) =>
      write(row.grant.principal, () =>
        grants.put(row.grant.principal, { role: row.grant.role, ...keep(row.grant), password }),
      ),

    /**
     * Sets or clears the expiry of a person, group or link row. It leaves the
     * password out of the write, so the server keeps it (Drive spec §5.9, D20).
     */
    setExpiry: (row: LocalRow, date: string | null) =>
      write(row.grant.principal, () =>
        grants.put(row.grant.principal, { role: row.grant.role, expires_on: date ? endOfDayStamp(date) : null }),
      ),

    /** Get new URL. Resolves with the new URL. */
    async rotate(row: LocalRow): Promise<string | undefined> {
      const name = row.grant.name
      if (!name) return undefined
      const written = await write(row.grant.principal, () => grants.rotate(name))
      return written?.url ?? written?.grant.url
    },
  }
}

export type ShareState = ReturnType<typeof useShare>

function managesNode(node: DriveNode | null): boolean {
  return (node?.access?.role ?? 0) >= DRIVE_ROLES.manage
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
