import { computed, reactive, readonly, ref, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'

import { announceAccessChange } from '@/apps/drive/client/accessChanges'
import { api } from '@/apps/drive/client/generated'
import {
  endOfDayStamp,
  isExpired,
  NEW_LINK,
  nodeGrants,
  principalKind,
  type DriveGrant,
  type GrantList,
  type GrantPatch,
  type GrantWrite,
} from '@/apps/drive/client/grants'
import { driveOperation } from '@/apps/drive/client/operation'
import { DRIVE_ROLES, type DriveNode, type DrivePerson } from '@/apps/drive/client/types'
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

const nodeGet = driveOperation<{ node: string; expand: string }, DriveNode>(api.node_get, {
  entity: true,
})

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
  /** The workspace name, which names everyone at the org. Empty or `undefined` while unknown. */
  workspace?: MaybeRefOrGetter<string | undefined>
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
  /** Users' names by id: from the owner and the people the grants name, and from the picker. */
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
  const sections = computed(() =>
    named.value && node.value ? shareSections(named.value, node.value.kind) : null,
  )
  const titles = computed(
    () =>
      new Map(
        (named.value?.inherited ?? []).map((entry) => [entry.source_node, entry.source_title]),
      ),
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
      for (const person of peopleIn(freshList)) names.set(person.id, person.full_name)
      loadError.value = ''
    } catch (error) {
      if (read === reads) loadError.value = messageOf(error, 'Could not load who has access.')
    }
  }

  /**
   * Runs one write for a row. A failure shows on the row, unless `fail` takes
   * the message instead: then the caller owns the row's message, and it is not
   * cleared first.
   */
  async function write<T>(
    key: RowKey,
    run: () => Promise<T>,
    fail?: (message: string) => void,
  ): Promise<T | undefined> {
    pending.add(key)
    if (!fail) errors.delete(key)
    notice.value = ''
    try {
      const answer = await run()
      changed.value = true
      return answer
    } catch (error) {
      const message = messageOf(error, 'Could not save this change.')
      if (fail) fail(message)
      else errors.set(key, message)
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
    if (kind === 'link' || kind === 'public' || (kind === 'user' && change.principal !== me))
      return true
    const explanation = await grants.explain(me).catch(() => null)
    if (!explanation || roleAfter(explanation, nodeId, change, me) >= explanation.role) return true
    return confirmLoss()
  }

  async function change<T>(
    key: RowKey,
    next: GrantChange,
    run: () => Promise<T>,
    fail?: (message: string) => void,
  ): Promise<T | undefined> {
    pending.add(key)
    if (await mayChange(next)) return write(key, run, fail)
    pending.delete(key)
    return undefined
  }

  const label = (principal: string) => principalLabel(principal, names, toValue(options.workspace))

  /**
   * Keeps a live row's expiry: a grant write replaces it (Drive spec §5.9).
   * Writing over an expired row starts it afresh.
   */
  const keep = (grant: DriveGrant | undefined): Pick<GrantWrite, 'expires_on'> =>
    grant ? { expires_on: isExpired(grant) ? null : grant.expires_on } : {}
  const localGrant = (principal: string) =>
    list.value?.grants.find((grant) => grant.principal === principal)
  /** Rewrites a listed row. A link is addressed by its grant id; every other row by its principal. */
  const rewrite = (row: LocalRow, write: GrantPatch) =>
    row.kind === 'link' && row.grant.name
      ? grants.patch(row.grant.name, write)
      : grants.put(row.grant.principal, write)

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
    organization: computed(() => organizationLabel(toValue(options.workspace))),
    isPending: (key: RowKey) => pending.has(key),
    rememberName(email: string, name: string | null) {
      if (name) names.set(email, name)
    },

    setRole: (row: LocalRow, role: number) =>
      change(row.grant.principal, { principal: row.grant.principal, role }, () =>
        rewrite(row, { role, ...keep(row.grant) }),
      ),

    /** Removes the local row. Then says whether access remains, and why (§7.4). */
    async remove(row: LocalRow, below = false) {
      const principal = row.grant.principal
      const removed = await change(principal, { principal, role: null }, async () => ({
        count:
          row.kind === 'link' && row.grant.name
            ? await grants.removeGrant(row.grant.name)
            : await grants.remove(principal, below),
      }))
      if (!removed) return
      // The count includes the row here, which this Remove started from.
      const inside = below && removed.count ? removed.count - 1 : 0
      const insideText = inside
        ? `Removed from ${inside} ${inside === 1 ? 'item' : 'items'} inside. `
        : ''
      let remaining: string | null = null
      if (row.kind !== 'link' && canManage.value && !row.denied) {
        const explanation = await grants.explain(principal).catch(() => null)
        remaining =
          explanation &&
          remainingAccess(label(principal), principal, explanation, titles.value, label)
      }
      notice.value = `${insideText}${remaining ?? ''}`.trim()
    },

    deny: (principal: string) =>
      change(principal, { principal, role: 0 }, () => grants.put(principal, { role: 0 })),
    allowAgain: (row: LocalRow) =>
      write(row.grant.principal, () => grants.remove(row.grant.principal)),

    /** Everyone at the org or Public on the web. `null` removes the local row. Keeps the expiry. */
    setGeneral: (principal: string, role: number | null) =>
      change(principal, { principal, role }, async () => {
        if (role === null) await grants.remove(principal)
        else await grants.put(principal, { role, ...keep(localGrant(principal)) })
      }),

    /**
     * Adds users and groups from the picker in turn (§7.8). An existing row
     * keeps its expiry. Resolves with those not added: a failed write, or a
     * declined confirm. The picker's message keeps a line for every failure.
     */
    async add(principals: readonly string[], role: number, notify: boolean): Promise<string[]> {
      errors.delete(PICKER)
      const lines: string[] = []
      const fail = (principal: string) => (message: string) => {
        lines.push(principals.length > 1 ? `${label(principal)}: ${message}` : message)
        errors.set(PICKER, lines.join('\n'))
      }
      const left: string[] = []
      for (const principal of principals) {
        const added = await change(
          PICKER,
          { principal, role },
          () =>
            grants.put(principal, {
              role,
              ...keep(localGrant(principal)),
              ...(principalKind(principal) === 'user' ? { notify } : {}),
            }),
          fail(principal),
        )
        if (!added) left.push(principal)
      }
      return left
    },

    /** Mints a link for one outsider and emails it (§7.8). */
    sendLink: (email: string, role: number) =>
      write(PICKER, () => grants.put(NEW_LINK, { role, send_to: email })),

    /** A View link with no expiry and no password (§7.7). Resolves with its URL. */
    async newLink(): Promise<string | undefined> {
      const written = await write(NEW_LINK_ROW, () =>
        grants.put(NEW_LINK, { role: DRIVE_ROLES.read }),
      )
      return written?.url
    },

    setPassword: (row: LocalRow, password: string | null) =>
      write(row.grant.principal, () =>
        rewrite(row, { role: row.grant.role, ...keep(row.grant), password }),
      ),

    /**
     * Sets or clears the expiry of a person, group or link row. It leaves the
     * password out of the write, so the server keeps it (Drive spec §5.9, D20).
     */
    setExpiry: (row: LocalRow, date: string | null) =>
      write(row.grant.principal, () =>
        rewrite(row, { role: row.grant.role, expires_on: date ? endOfDayStamp(date) : null }),
      ),

    /** Get new URL. Resolves with the new URL. */
    async rotate(row: LocalRow): Promise<string | undefined> {
      const name = row.grant.name
      if (!name) return undefined
      const written = await write(row.grant.principal, () => grants.rotate(name))
      return written?.url
    },
  }
}

export type ShareState = ReturnType<typeof useShare>

/** Everyone a grants read names as a person: the owner and each user principal, inherited rows included. */
function peopleIn(list: GrantList | null): DrivePerson[] {
  if (!list) return []
  const rows = [...list.grants, ...list.inherited.map((entry) => entry.grant)]
  return [
    ...(list.owner ? [list.owner] : []),
    ...rows.flatMap((grant) => (grant.person ? [grant.person] : [])),
  ]
}

function managesNode(node: DriveNode | null): boolean {
  return (node?.access?.role ?? 0) >= DRIVE_ROLES.manage
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
