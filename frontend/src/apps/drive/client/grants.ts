import { transport as defaultTransport, type Transport } from '@/platform/transport'

import { api } from './generated'
import { driveOperation } from './operation'
import { DRIVE_ROLES } from './types'

/**
 * Drive grants as the share dialog reads and writes them (Drive spec §11.2).
 *
 * A principal is one of five spellings (Drive spec §4.4): a user's email,
 * `$GROUP:<name>`, `$GENERAL` (everyone at the org), `$PUBLIC` (public on the
 * web) and `$LINK:<token>`. Role 0 is an explicit deny.
 */

export const GENERAL = '$GENERAL'
export const PUBLIC = '$PUBLIC'
export const NEW_LINK = '$LINK'
const GROUP_PREFIX = '$GROUP:'
const LINK_PREFIX = '$LINK'

export type PrincipalKind = 'user' | 'group' | 'general' | 'public' | 'link'

export interface DriveGrant {
  node: string
  principal: string
  /** 0 is an explicit deny. */
  role: number
  /** `YYYY-MM-DD HH:MM:SS`, or `null` for no expiry. */
  expires_on: string | null
  has_password: boolean
  /** Absent on a redacted inherited link. */
  name?: string
  sent_to?: string | null
  /** `/l/<token>`, on a link grant. */
  url?: string
}

export interface InheritedGrant {
  grant: DriveGrant
  /** A link on an ancestor the caller does not manage: no name, URL or recipient. */
  redacted: boolean
  source_node: string
  source_title: string
}

export interface GrantList {
  /** The node's own rows, expired ones included. */
  grants: DriveGrant[]
  /** Live grants on ancestors, nearest ancestor first. */
  inherited: InheritedGrant[]
}

export interface ExplainRow {
  node: string
  depth: number
  principal: string
  role: number
  expires_on: string | null
  /** 1: the subject's own principals (user, groups, org). 2: open ones (public, links). */
  pass: number
  held: boolean
  winner: boolean
}

export interface GrantExplanation {
  role: number
  source: string
  rows: ExplainRow[]
}

/**
 * One grant write. `role` and `expires_on` replace the stored values, so a
 * write that keeps an expiry sends it again. An omitted `password` keeps the
 * stored one, `null` clears it.
 */
export interface GrantWrite {
  role: number
  expires_on?: string | null
  password?: string | null
  /** On a new link: mint it for this one address and email it. */
  send_to?: string
  /** On a user: email them as well as the in-app notification. */
  notify?: boolean
}

export interface WrittenGrant {
  grant: DriveGrant
  url?: string
}

export interface Role {
  value: number
  label: string
}

const ROLE_LABELS: Record<number, string> = {
  [DRIVE_ROLES.read]: 'View',
  [DRIVE_ROLES.comment]: 'Comment',
  [DRIVE_ROLES.upload]: 'Upload',
  [DRIVE_ROLES.edit]: 'Edit',
  [DRIVE_ROLES.manage]: 'Manage',
}

export function roleLabel(role: number): string {
  return ROLE_LABELS[role] ?? (role <= 0 ? 'No access' : `Role ${role}`)
}

export function principalKind(principal: string): PrincipalKind {
  if (principal === GENERAL) return 'general'
  if (principal === PUBLIC) return 'public'
  if (principal.startsWith(GROUP_PREFIX)) return 'group'
  if (principal.startsWith(LINK_PREFIX)) return 'link'
  return 'user'
}

export function groupPrincipal(group: string): string {
  return `${GROUP_PREFIX}${group}`
}

export function groupName(principal: string): string {
  return principal.slice(GROUP_PREFIX.length)
}

/** Upload gives nothing on a file or document (Drive spec §4.2). */
function holdsChildren(nodeKind: string): boolean {
  return nodeKind === 'folder' || nodeKind === 'root'
}

/** The roles the dialog offers each principal (unified spec §7.5). Off is not a role. */
export function rolesFor(kind: PrincipalKind, nodeKind: string): Role[] {
  const ceiling = {
    user: DRIVE_ROLES.manage,
    group: DRIVE_ROLES.manage,
    general: DRIVE_ROLES.edit,
    link: DRIVE_ROLES.edit,
    public: DRIVE_ROLES.read,
  }[kind]
  return Object.values(DRIVE_ROLES)
    .filter((role) => role <= ceiling)
    .filter((role) => role !== DRIVE_ROLES.upload || holdsChildren(nodeKind))
    .map((value) => ({ value, label: roleLabel(value) }))
}

/** An expired grant is inert but stays listed (Drive spec §6.4). */
export function isExpired(grant: Pick<DriveGrant, 'expires_on'>, now = new Date()): boolean {
  if (!grant.expires_on) return false
  return parseStamp(grant.expires_on).getTime() <= now.getTime()
}

/** A server stamp, read as local time like every other Drive date. */
export function parseStamp(stamp: string): Date {
  return new Date(stamp.replace(' ', 'T'))
}

/**
 * Access ends at the end of the chosen day (unified spec §7.9). The stamp has
 * no zone, so the server reads it in the site's timezone: the frontend is not
 * told the site's zone, so it cannot convert from the sharer's.
 */
export function endOfDayStamp(date: string): string {
  return `${date.slice(0, 10)} 23:59:59`
}

const listOperation = driveOperation<{ node: string; inherited: 1 }, GrantList>(api.node_grants, {
  looseInput: true,
})
const explainOperation = driveOperation<{ node: string; principal: string }, { explain: GrantExplanation }>(
  api.node_grants,
  { looseInput: true },
)
const putOperation = driveOperation<{ node: string; principal: string } & GrantWrite, WrittenGrant>(
  api.node_put_grant,
  { looseInput: true },
)
const deleteOperation = driveOperation<{ node: string; principal: string; below?: 1 }, { rows?: number }>(
  api.node_delete_grant,
  { looseInput: true },
)
// Rotation names a grant, not a node, so it carries the node's link codes itself.
const rotateOperation = (node: string) =>
  driveOperation<{ grant: string }, WrittenGrant>(api.grant_rotate, { covers: [node] })

/** The grant calls of one node. Every call needs MANAGE on it. */
export function nodeGrants(node: string, transport: Transport = defaultTransport) {
  return {
    async list(): Promise<GrantList> {
      const answer = await transport.request(listOperation, { node, inherited: 1 })
      return { grants: answer.grants ?? [], inherited: answer.inherited ?? [] }
    },
    async explain(principal: string): Promise<GrantExplanation> {
      return (await transport.request(explainOperation, { node, principal })).explain
    },
    put(principal: string, write: GrantWrite): Promise<WrittenGrant> {
      return transport.request(putOperation, { node, principal, ...write })
    },
    /** Removes the local row. `below` also removes it from every item inside; the answer counts them. */
    async remove(principal: string, below = false): Promise<number | undefined> {
      const answer = await transport.request(deleteOperation, { node, principal, ...(below ? { below: 1 as const } : {}) })
      return answer.rows
    },
    rotate(grant: string): Promise<WrittenGrant> {
      return transport.request(rotateOperation(node), { grant })
    },
  }
}

export type NodeGrants = ReturnType<typeof nodeGrants>
