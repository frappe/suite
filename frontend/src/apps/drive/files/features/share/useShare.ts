import { computed, reactive, ref, shallowRef } from 'vue'

import {
  NEW_LINK,
  endOfDayStamp,
  nodeGrants,
  principalKind,
  type DriveGrant,
  type GrantList,
  type GrantWrite,
} from '@/apps/drive/client/grants'
import { api } from '@/apps/drive/client/generated'
import { driveOperation } from '@/apps/drive/client/operation'
import { DRIVE_ROLES, type DriveNode } from '@/apps/drive/client/types'
import { transport as defaultTransport, type Transport } from '@/platform/transport'

import { principalLabel, remainingAccess, shareSections, type LocalRow } from './shareModel'

const nodeGet = driveOperation<{ node: string; expand: string }, DriveNode>(api.node_get, { entity: true })

/** A row key: the principal, or a section key for the picker and + New link. */
export type RowKey = string
export const PICKER: RowKey = 'picker'
export const NEW_LINK_ROW: RowKey = 'new-link'

/**
 * The share dialog's state for one node. Every write reads the grants and the
 * caller's access again (unified spec §7.9). A failed write keeps its message
 * on its own row.
 */
export function useShare(nodeId: string, transport: Transport = defaultTransport) {
  const grants = nodeGrants(nodeId, transport)
  const node = shallowRef<DriveNode | null>(null)
  const list = shallowRef<GrantList | null>(null)
  const loadError = ref('')
  const errors = reactive(new Map<RowKey, string>())
  const pending = ref<RowKey | null>(null)
  const notice = ref('')
  /** Names the picker has seen, by email. The grant rows carry emails only. */
  const names = reactive(new Map<string, string>())

  const canManage = computed(() => (node.value?.access?.role ?? 0) >= DRIVE_ROLES.manage)
  const sections = computed(() => (list.value && node.value ? shareSections(list.value, node.value.kind) : null))
  const titles = computed(
    () => new Map((list.value?.inherited ?? []).map((entry) => [entry.source_node, entry.source_title])),
  )

  async function load() {
    try {
      node.value = await transport.request(nodeGet, { node: nodeId, expand: 'access' })
      // Reading grants needs MANAGE (spec §7.2). A caller who gave it away sees why.
      list.value = canManage.value ? await grants.list() : null
      loadError.value = ''
    } catch (error) {
      loadError.value = messageOf(error, 'Could not load who has access.')
    }
  }

  async function write<T>(key: RowKey, run: () => Promise<T>): Promise<T | undefined> {
    pending.value = key
    errors.delete(key)
    notice.value = ''
    try {
      return await run()
    } catch (error) {
      errors.set(key, messageOf(error, 'Could not save this change.'))
      return undefined
    } finally {
      await load()
      pending.value = null
    }
  }

  const label = (principal: string) => principalLabel(principal, names)

  /** Keeps the row's expiry: a grant write replaces it (Drive spec §5.9). */
  const keep = (grant: DriveGrant): Pick<GrantWrite, 'expires_on'> => ({ expires_on: grant.expires_on })

  return {
    node,
    sections,
    loadError,
    errors,
    pending,
    notice,
    canManage,
    load,
    label,
    rememberName(email: string, name: string | null) {
      if (name) names.set(email, name)
    },

    setRole: (row: LocalRow, role: number) =>
      write(row.grant.principal, () => grants.put(row.grant.principal, { role, ...keep(row.grant) })),

    /** Removes the local row. Then says whether access remains, and why (§7.4). */
    async remove(row: LocalRow, below = false) {
      const principal = row.grant.principal
      const removed = await write(principal, async () => {
        const count = await grants.remove(principal, below)
        return { count }
      })
      if (!removed) return
      const inside = below && removed.count ? `Removed from ${removed.count} ${removed.count === 1 ? 'item' : 'items'} inside. ` : ''
      let remaining: string | null = null
      if (row.kind !== 'link' && canManage.value && !row.denied) {
        const explanation = await grants.explain(principal).catch(() => null)
        remaining = explanation && remainingAccess(label(principal), principal, explanation, titles.value, label)
      }
      notice.value = `${inside}${remaining ?? ''}`.trim()
    },

    deny: (principal: string) => write(principal, () => grants.put(principal, { role: 0 })),
    allowAgain: (row: LocalRow) => write(row.grant.principal, () => grants.remove(row.grant.principal)),

    /** Everyone at the org or Public on the web. `null` removes the local row. */
    setGeneral: (principal: string, role: number | null) =>
      write(principal, async () => {
        if (role === null) await grants.remove(principal)
        else await grants.put(principal, { role })
      }),

    /** Adds a user or a group from the picker (§7.8). */
    add: (principal: string, role: number, notify: boolean) =>
      write(PICKER, () =>
        grants.put(principal, { role, ...(principalKind(principal) === 'user' ? { notify } : {}) }),
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

    /** Leaves the password out of the write, so the server keeps it (Drive spec §5.9, D20). */
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

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
