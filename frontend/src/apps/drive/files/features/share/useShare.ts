import { computed, reactive, readonly, ref, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'

import { client } from '@/api'
import {
  endOfDayStamp,
  isExpired,
  NEW_LINK,
  nodeGrants,
  principalKind,
  PUBLIC,
  type DriveGrant,
  type GrantList,
  type GrantPatch,
  type GrantWrite,
} from '@/apps/drive/client/grants'
import { driveLinks } from '@/apps/drive/client/links'
import {
  canManage as canManageNode,
  DRIVE_ROLES,
  type DriveNode,
  type DrivePerson,
} from '@/apps/drive/client/types'
import type { ImperativeClient } from '@/platform/server-state/types'
import { translate as __ } from '@/platform/translation'
import { TransportError } from '@/platform/transport'

import { readShare, type ShareReads } from './opening'
import {
  organizationLabel,
  principalLabel,
  remainingAccess,
  roleAfter,
  shareSections,
  type GrantChange,
  type LocalRow,
} from './shareModel'

/** A row key: the principal, or a section key for the picker and link creation. */
export type RowKey = string
export const PICKER: RowKey = 'picker'
export const NEW_LINK_ROW: RowKey = 'new-link'
/** The notice's Undo, which puts back a removed row. */
export const UNDO_ROW: RowKey = 'undo'

export interface ShareOptions {
  client?: ImperativeClient
  /** The caller's user id: writes that would lower their own access ask first. */
  me?: string
  /** Asks the caller to confirm a write that lowers their own role to `after`. Resolves true to go on. */
  confirmLoss?: (after: number) => Promise<boolean>
  /** The workspace name, which names everyone at the org. Empty while unknown. */
  workspace?: MaybeRefOrGetter<string>
  /** The name an ancestor shows under, such as "My files" for the caller's own root. Defaults to its title. */
  placeTitle?: (node: { name: string; title: string }) => string
  /** The node as the opener last read it, such as a listing row, shown until the fresh read lands. */
  known?: DriveNode
  /** The reads the opener already started, which stand in for the first read. */
  reads?: ShareReads
}

/**
 * The share dialog's state for one node. Every write reads the grants and the
 * caller's access again, and tells open sessions of the node (unified spec
 * §7.9). A failed write keeps its message on its own row. Rows write
 * independently: each has its own pending flag, and only the newest read
 * lands.
 */
export function useShare(nodeId: string, options: ShareOptions = {}) {
  const placeTitle = options.placeTitle ?? ((node: { title: string }) => node.title)
  const requester = options.client ?? client
  const grants = nodeGrants(nodeId, requester)
  const node = shallowRef<DriveNode | null>(options.known ?? null)
  const list = shallowRef<GrantList | null>(null)
  const loadError = ref('')
  const errors = reactive(new Map<RowKey, string>())
  const pending = reactive(new Set<RowKey>())
  const notice = ref('')
  /** The row the notice's Undo writes back. The next write clears it. */
  const removed = shallowRef<{ principal: string; write: GrantWrite } | null>(null)
  /** A write went through since the dialog opened. */
  const changed = ref(false)
  /** Users' names by id: from the owner and the people the grants name, and from the picker. */
  const names = reactive(new Map<string, string>())

  const canManage = computed(() => canManageNode(node.value))
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

  /** Both reads, at once where the node already says the caller manages it. */
  async function readBoth(read: number): Promise<[DriveNode, GrantList | null]> {
    const started =
      read === 1 && options.reads ? options.reads : readShare(nodeId, node.value, requester)
    return [await started.node, await started.list]
  }

  let reads = 0
  /** The newest read, which a write that keeps a row's expiry waits for. */
  let reading: Promise<void> = Promise.resolve()
  function load(): Promise<void> {
    reading = refresh()
    return reading
  }
  async function refresh() {
    const read = ++reads
    try {
      const [fresh, freshList] = await readBoth(read)
      if (read !== reads) return
      node.value = fresh
      list.value = freshList
      for (const person of peopleIn(freshList)) names.set(person.id, person.full_name)
      loadError.value = ''
    } catch (error) {
      if (read !== reads) return
      // A write here took away the caller's own access: the page behind drops what it read before.
      const lostAccess = changed.value && isRefusal(error)
      loadError.value = lostAccess
        ? __('You no longer have access to this item.')
        : messageOf(error, __('Could not load who has access.'))
      if (lostAccess) driveLinks.invalidateAccess()
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
    removed.value = null
    errors.delete(UNDO_ROW)
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
    if (!explanation) return true
    // Drive's own account holds every right, whatever the grants say.
    if (explanation.source === 'system') return true
    const after = roleAfter(explanation, nodeId, change, me)
    if (after >= explanation.role) return true
    return confirmLoss(after)
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
  const rewrite = (row: LocalRow, patch: GrantPatch) =>
    row.kind === 'link' && row.grant.name
      ? grants.patch(row.grant.name, patch)
      : grants.put(row.grant.principal, patch)

  /** Everyone at the org or Public on the web. `null` removes the local row. Keeps the expiry. */
  const setGeneral = (principal: string, role: number | null) =>
    change(principal, { principal, role }, async () => {
      if (role === null) await grants.remove(principal)
      else await grants.put(principal, { role, ...keep(localGrant(principal)) })
    })

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
      const outcome = await change(principal, { principal, role: null }, async () => ({
        count:
          row.kind === 'link' && row.grant.name
            ? await grants.removeGrant(row.grant.name)
            : await grants.remove(principal, below),
      }))
      if (!outcome) return
      // The count includes the row here, which this Remove started from.
      const inside = below && outcome.count ? outcome.count - 1 : 0
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
      // A plain Remove can be undone. Removing inside asks first instead (§7.4).
      const undoable = !below && row.kind !== 'link' && !row.expired && !row.denied
      if (undoable) {
        const restored: GrantWrite = { role: row.grant.role, ...keep(row.grant) }
        // Putting someone back is not news to them.
        if (row.kind === 'user') restored.notify = false
        removed.value = { principal, write: restored }
      }
      const removedText = undoable ? `${__('Removed {0}.', [label(principal)])} ` : ''
      notice.value = `${removedText}${insideText}${remaining ?? ''}`.trim()
    },

    /** Whether the notice offers Undo for the row a Remove just took away. */
    canUndo: computed(() => removed.value !== null),
    /** Puts back the row a Remove just took away, with its role and expiry, and no email. */
    async undoRemove() {
      const last = removed.value
      if (!last) return undefined
      const shown = notice.value
      const restored = await write(UNDO_ROW, () => grants.put(last.principal, last.write))
      // A failed Undo can be tried again, unless a newer Remove took the notice meanwhile.
      if (!restored && !removed.value) {
        removed.value = last
        notice.value = shown
      }
      return restored
    },

    deny: (principal: string) =>
      change(principal, { principal, role: 0 }, () => grants.put(principal, { role: 0 })),
    allowAgain: (row: LocalRow) =>
      write(row.grant.principal, () => grants.remove(row.grant.principal)),

    setGeneral,

    /** The switch publishes here or removes the local row, and never writes a deny (§5.10). */
    setPublic(enabled: boolean) {
      return setGeneral(PUBLIC, enabled ? DRIVE_ROLES.read : null)
    },

    /**
     * Adds users and groups from the picker in turn (§7.8). An existing row
     * keeps its expiry. Resolves with those not added: a failed write, or a
     * declined confirm. The picker's message keeps a line for every failure.
     */
    async add(principals: readonly string[], role: number, notify: boolean): Promise<string[]> {
      // The Share button is busy from the first click, or a second one would mail twice.
      pending.add(PICKER)
      try {
        // The picker shows before who has access arrives; an existing row's expiry comes from it.
        await reading
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
            () => {
              const body: Parameters<typeof grants.put>[1] = {
                role,
                ...keep(localGrant(principal)),
              }
              if (principalKind(principal) === 'user') body.notify = notify
              return grants.put(principal, body)
            },
            fail(principal),
          )
          if (!added) left.push(principal)
        }
        return left
      } finally {
        pending.delete(PICKER)
      }
    },

    /** Mints a link for one outsider and emails it (§7.8). */
    sendLink: (email: string, role: number) =>
      write(PICKER, () => grants.put(NEW_LINK, { role, send_to: email })),

    /** Creates a share link with the chosen access and protection (§7.7). Resolves with its URL. */
    async newLink(link: GrantPatch = { role: DRIVE_ROLES.read }): Promise<string | undefined> {
      const written = await write(NEW_LINK_ROW, () => grants.put(NEW_LINK, link))
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

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** The server no longer lets the caller read the item. */
function isRefusal(error: unknown): boolean {
  return error instanceof TransportError && [403, 404, 410].includes(error.status)
}
